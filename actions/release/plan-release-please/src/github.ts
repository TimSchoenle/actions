import { hasStatus } from 'actions-util';
import { createOctokit } from 'actions-util/client';

import type { RepositoryCoordinates } from 'actions-util';

/** The parts of a pull request associated with a commit that the plan reads. */
export interface AssociatedPullRequest {
  readonly number: number;
  readonly mergedAt: string | null;
  readonly mergeCommitSha: string | null;
  readonly baseRef: string;
  readonly authorId: number | undefined;
  readonly labels: readonly string[];
}

/** The read-only GitHub API surface the plan needs. Injected so tests need no GitHub. */
export interface ReleaseStateApi {
  defaultBranch(): Promise<string>;
  /** The parents of a commit, in order. */
  commitParents(sha: string): Promise<string[]>;
  /** A file's text at a commit, or `undefined` when it does not exist there. */
  fileAt(path: string, ref: string): Promise<string | undefined>;
  pullRequestsForCommit(sha: string): Promise<AssociatedPullRequest[]>;
  /** Every tag name that starts with `prefix`. */
  tagsWithPrefix(prefix: string): Promise<Set<string>>;
}

/** GitHub's largest page size. */
const PER_PAGE = 100;

/** Binds {@link ReleaseStateApi} to the REST API. */
export function createReleaseStateApi(token: string, repository: RepositoryCoordinates): ReleaseStateApi {
  const octokit = createOctokit(token);
  const { owner, repo } = repository;

  return {
    async defaultBranch() {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo });

      return data.default_branch;
    },

    async commitParents(sha) {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
        commit_sha: sha,
        owner,
        repo,
      });

      return data.parents.map((parent) => parent.sha);
    },

    async fileAt(path, ref) {
      try {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
          owner,
          path,
          ref,
          repo,
        });
        if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
          throw new Error(`${path} at ${ref} is not a file.`);
        }

        return Buffer.from(data.content, 'base64').toString('utf8');
      } catch (error) {
        if (hasStatus(error, 404)) {
          return undefined;
        }
        throw error;
      }
    },

    async pullRequestsForCommit(sha) {
      const pulls = await octokit.paginate('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', {
        commit_sha: sha,
        owner,
        per_page: PER_PAGE,
        repo,
      });

      return pulls.map((pull) => ({
        authorId: pull.user?.id,
        baseRef: pull.base.ref,
        labels: pull.labels.map((label) => label.name),
        mergeCommitSha: pull.merge_commit_sha,
        mergedAt: pull.merged_at,
        number: pull.number,
      }));
    },

    async tagsWithPrefix(prefix) {
      // The endpoint's generated types leave the paginated item untyped; each item is a git ref.
      const refs: ReadonlyArray<{ ref: string }> = await octokit.paginate(
        'GET /repos/{owner}/{repo}/git/matching-refs/{ref}',
        { owner, per_page: PER_PAGE, ref: `tags/${prefix}`, repo },
      );

      return new Set(refs.map((ref) => ref.ref.slice('refs/tags/'.length)));
    },
  };
}
