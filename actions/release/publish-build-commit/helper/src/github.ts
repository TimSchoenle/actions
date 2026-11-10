import { hasStatus } from 'actions-util';
import { createOctokit } from 'actions-util/client';

import type { ArtifactRecord } from 'action-graph';
import type { RepositoryCoordinates } from 'actions-util';

/** A commit as the Git Data API returns it. */
export interface GitCommit {
  readonly sha: string;
  readonly tree: string;
  readonly parents: readonly string[];
}

/** One entry of a tree object, as the Git Data API returns it. */
export interface GitTreeItem {
  readonly name: string;
  readonly mode: string;
  readonly type: 'blob' | 'tree' | 'commit';
  readonly sha: string;
}

export interface ReleaseAsset {
  readonly id: number;
  readonly name: string;
}

export interface Release {
  readonly id: number;
  readonly tagName: string;
  readonly draft: boolean;
  readonly htmlUrl: string;
  readonly uploadUrl: string;
  readonly assets: readonly ReleaseAsset[];
}

/** The `make_latest` values the Releases API accepts. */
export type MakeLatest = 'true' | 'false' | 'legacy';

/** How a comparison of two commits came out: `head` relative to `base`. */
export type CompareStatus = 'identical' | 'ahead' | 'behind' | 'diverged';

/**
 * The GitHub API surface publishing needs. Injected so tests run against an in-memory repository.
 *
 * Every write is a single request whose effect can be read back, so the caller can make each step an
 * "ensure": check, then act only on a difference.
 */
export interface PublishApi {
  getCommit(sha: string): Promise<GitCommit>;
  /** The entries of one tree object, not recursive. */
  getTree(sha: string): Promise<GitTreeItem[]>;
  /** The commit a ref (`heads/x`, `tags/x`) points at, following an annotated tag; `undefined` when absent. */
  resolveRef(ref: string): Promise<string | undefined>;
  createBlob(content: Uint8Array): Promise<string>;
  /** Creates a tree from `baseTree` with each file set to its blob. */
  createTree(baseTree: string, files: ReadonlyArray<{ path: string; sha: string }>): Promise<string>;
  /** Creates a commit without author or committer, so GitHub signs it. */
  createCommit(message: string, tree: string, parents: readonly string[]): Promise<string>;
  /** Creates `refs/<ref>`; `exists` when a ref of that name is already there. */
  createRef(ref: string, sha: string): Promise<'created' | 'exists'>;
  /** Moves `refs/<ref>` without force; `not-fast-forward` when the move is not one. */
  updateRef(ref: string, sha: string): Promise<'updated' | 'not-fast-forward'>;
  compare(base: string, head: string): Promise<CompareStatus>;
  /** Every release, drafts included. */
  listReleases(): Promise<Release[]>;
  createDraftRelease(tagName: string, name: string, body: string): Promise<Release>;
  publishRelease(id: number, name: string, body: string, makeLatest: MakeLatest): Promise<Release>;
  uploadAsset(release: Release, name: string, content: Uint8Array): Promise<ReleaseAsset>;
  deleteAsset(id: number): Promise<void>;
  issueLabels(issue: number): Promise<string[]>;
  addLabel(issue: number, label: string): Promise<void>;
  removeLabel(issue: number, label: string): Promise<void>;
  issueCommentBodies(issue: number): Promise<string[]>;
  createComment(issue: number, body: string): Promise<void>;
}

const PER_PAGE = 100;

/** GitHub's answer to a write it refused as invalid: an existing ref, a non-fast-forward update. */
const UNPROCESSABLE = 422;

function toRelease(data: {
  id: number;
  tag_name: string;
  draft: boolean;
  html_url: string;
  upload_url: string;
  assets: ReadonlyArray<{ id: number; name: string }>;
}): Release {
  return {
    id: data.id,
    tagName: data.tag_name,
    draft: data.draft,
    htmlUrl: data.html_url,
    uploadUrl: data.upload_url,
    assets: data.assets.map((asset) => ({ id: asset.id, name: asset.name })),
  };
}

/**
 * The upload endpoint of a release, taken from its `upload_url` and checked to name exactly this
 * release of this repository over HTTPS, so a tampered response cannot redirect the upload.
 */
export function uploadEndpoint(release: Release, repository: RepositoryCoordinates): URL {
  const url = new URL(release.uploadUrl.replace(/\{[^}]*\}$/, ''));
  const suffix = `/repos/${repository.owner}/${repository.repo}/releases/${release.id}/assets`;
  if (url.protocol !== 'https:' || !url.pathname.endsWith(suffix) || url.search !== '' || url.username !== '') {
    throw new Error(`Release ${release.id} has an unexpected upload URL: ${release.uploadUrl}`);
  }

  return url;
}

/** Binds {@link PublishApi} to the REST API with `token`. */
export function createPublishApi(token: string, repository: RepositoryCoordinates): PublishApi {
  const octokit = createOctokit(token);
  const { owner, repo } = repository;

  /**
   * Whether `ref` is there after `refusal`, the 422 that creating it got. A failed lookup reports
   * the refusal, not itself: the lookup failure becomes the refusal's cause, and the refusal is thrown.
   */
  async function existsAfterRefusal(ref: string, refusal: unknown): Promise<boolean> {
    try {
      return (await api.resolveRef(ref)) !== undefined;
    } catch (lookupError) {
      if (refusal instanceof Error && refusal.cause === undefined) {
        refusal.cause = lookupError;
      }
      throw refusal;
    }
  }

  const api: PublishApi = {
    async getCommit(sha) {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
        commit_sha: sha,
        owner,
        repo,
      });

      return { sha: data.sha, tree: data.tree.sha, parents: data.parents.map((parent) => parent.sha) };
    },

    async getTree(sha) {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
        owner,
        repo,
        tree_sha: sha,
      });
      if (data.truncated) {
        throw new Error(`Tree ${sha} was truncated by the API.`);
      }

      return data.tree.map((item) => ({
        name: item.path,
        mode: item.mode,
        sha: item.sha,
        type: item.type as GitTreeItem['type'],
      }));
    },

    async resolveRef(ref) {
      try {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', { owner, ref, repo });
        if (data.object.type !== 'tag') {
          return data.object.sha;
        }
        const tag = await octokit.request('GET /repos/{owner}/{repo}/git/tags/{tag_sha}', {
          owner,
          repo,
          tag_sha: data.object.sha,
        });

        return tag.data.object.sha;
      } catch (error) {
        if (hasStatus(error, 404)) {
          return undefined;
        }
        throw error;
      }
    },

    async createBlob(content) {
      const { data } = await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
        content: Buffer.from(content).toString('base64'),
        encoding: 'base64',
        owner,
        repo,
      });

      return data.sha;
    },

    async createTree(baseTree, files) {
      const { data } = await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
        base_tree: baseTree,
        owner,
        repo,
        tree: files.map((file) => ({ mode: '100644' as const, path: file.path, sha: file.sha, type: 'blob' as const })),
      });

      return data.sha;
    },

    async createCommit(message, tree, parents) {
      const { data } = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
        message,
        owner,
        parents: [...parents],
        repo,
        tree,
      });

      return data.sha;
    },

    async createRef(ref, sha) {
      try {
        await octokit.request('POST /repos/{owner}/{repo}/git/refs', { owner, ref: `refs/${ref}`, repo, sha });

        return 'created';
      } catch (error) {
        // 422 also answers an unknown object or an invalid ref name: only a ref that is there exists.
        if (hasStatus(error, UNPROCESSABLE) && (await existsAfterRefusal(ref, error))) {
          return 'exists';
        }
        throw error;
      }
    },

    async updateRef(ref, sha) {
      try {
        await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', { force: false, owner, ref, repo, sha });

        return 'updated';
      } catch (error) {
        if (hasStatus(error, UNPROCESSABLE)) {
          return 'not-fast-forward';
        }
        throw error;
      }
    },

    async compare(base, head) {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
        basehead: `${base}...${head}`,
        owner,
        per_page: 1,
        repo,
      });

      return data.status;
    },

    async listReleases() {
      const releases = await octokit.paginate('GET /repos/{owner}/{repo}/releases', {
        owner,
        per_page: PER_PAGE,
        repo,
      });

      return releases.map(toRelease);
    },

    async createDraftRelease(tagName, name, body) {
      const { data } = await octokit.request('POST /repos/{owner}/{repo}/releases', {
        body,
        draft: true,
        name,
        owner,
        repo,
        tag_name: tagName,
      });

      return toRelease(data);
    },

    async publishRelease(id, name, body, makeLatest) {
      const { data } = await octokit.request('PATCH /repos/{owner}/{repo}/releases/{release_id}', {
        body,
        draft: false,
        make_latest: makeLatest,
        name,
        owner,
        release_id: id,
        repo,
      });

      return toRelease(data);
    },

    async uploadAsset(release, name, content) {
      const url = uploadEndpoint(release, repository);
      url.searchParams.set('name', name);
      const { data } = await octokit.request({
        data: Buffer.from(content),
        headers: { 'content-length': content.byteLength, 'content-type': 'application/octet-stream' },
        method: 'POST',
        url: url.toString(),
      });
      const asset = data as { id: number; name: string };

      return { id: asset.id, name: asset.name };
    },

    async deleteAsset(id) {
      await octokit.request('DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}', { asset_id: id, owner, repo });
    },

    async issueLabels(issue) {
      const labels = await octokit.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/labels', {
        issue_number: issue,
        owner,
        per_page: PER_PAGE,
        repo,
      });

      return labels.map((label) => label.name);
    },

    async addLabel(issue, label) {
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
        issue_number: issue,
        labels: [label],
        owner,
        repo,
      });
    },

    async removeLabel(issue, label) {
      try {
        await octokit.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', {
          issue_number: issue,
          name: label,
          owner,
          repo,
        });
      } catch (error) {
        if (!hasStatus(error, 404)) {
          throw error;
        }
      }
    },

    async issueCommentBodies(issue) {
      const comments = await octokit.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        issue_number: issue,
        owner,
        per_page: PER_PAGE,
        repo,
      });

      return comments.map((comment) => comment.body ?? '');
    },

    async createComment(issue, body) {
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        body,
        issue_number: issue,
        owner,
        repo,
      });
    },
  };

  return api;
}

/** Reads an artifact record with `token`, which needs `actions: read`. */
export async function fetchArtifactRecord(
  token: string,
  repository: RepositoryCoordinates,
  id: number,
): Promise<ArtifactRecord> {
  const { data } = await createOctokit(token).request('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}', {
    artifact_id: id,
    owner: repository.owner,
    repo: repository.repo,
  });

  return {
    id: data.id,
    expired: data.expired,
    digest: data.digest,
    workflow_run: data.workflow_run === null ? null : { id: data.workflow_run?.id },
  };
}
