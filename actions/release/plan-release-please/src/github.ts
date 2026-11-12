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
  /** Which of `names` exist as tags. */
  existingTags(names: readonly string[]): Promise<Set<string>>;
}

/** GitHub's largest page size. */
const PER_PAGE = 100;

/** How many tags one GraphQL query looks up, which keeps each query far below GitHub's node limit. */
const TAGS_PER_QUERY = 100;

/**
 * A query that looks up `count` tags by name, one aliased `ref(qualifiedName:)` each. The names travel
 * as variables `$t0` and up, never inside the query text.
 */
function existingTagsQuery(count: number): string {
  const indexes = Array.from({ length: count }, (_, index) => index);
  const variables = indexes.map((index) => `$t${index}: String!`).join(', ');
  const lookups = indexes.map((index) => `t${index}: ref(qualifiedName: $t${index}) { name }`).join('\n    ');

  return `query($owner: String!, $repo: String!, ${variables}) {\n  repository(owner: $owner, name: $repo) {\n    ${lookups}\n  }\n}`;
}

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
        // Above 1 MB the contents API sends no content and `encoding: none`; decoding that would
        // read the file as empty.
        if (data.encoding !== 'base64') {
          throw new Error(
            `${path} at ${ref} is too large for the contents API (${data.size} bytes, encoding ${JSON.stringify(data.encoding)}).`,
          );
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

    async existingTags(names) {
      const found = new Set<string>();
      for (let start = 0; start < names.length; start += TAGS_PER_QUERY) {
        const batch = names.slice(start, start + TAGS_PER_QUERY);
        const lookups = Object.fromEntries(batch.map((name, index) => [`t${index}`, `refs/tags/${name}`]));
        const { repository } = await octokit.graphql<{ repository: Record<string, { name: string } | null> }>(
          existingTagsQuery(batch.length),
          { owner, repo, ...lookups },
        );
        batch.forEach((name, index) => {
          if (repository[`t${index}`] !== null && repository[`t${index}`] !== undefined) {
            found.add(name);
          }
        });
      }

      return found;
    },
  };
}
