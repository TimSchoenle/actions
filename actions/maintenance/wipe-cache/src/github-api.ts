import { hasStatus } from 'actions-util';
import { createOctokit } from 'actions-util/client';

import type { RepositoryCoordinates } from 'actions-util';

/** One cache entry, reduced to what deleting and reporting it needs. */
export interface CacheEntry {
  /** The id `DELETE /actions/caches/{cache_id}` takes. */
  id: number;
  /** The key the workflow saved it under, for the log. */
  key: string;
  /** The ref GitHub recorded it against, e.g. `refs/heads/feature/x`. */
  ref: string;
  /** Size in bytes, for the summary; 0 when GitHub omits it. */
  sizeInBytes: number;
}

/** What a single delete request achieved. */
export type DeleteOutcome = 'deleted' | 'not-found';

/** The GitHub operations this action needs, kept minimal so it can be faked in tests. */
export interface CacheApi {
  /** The repository's default branch, by short name. */
  getDefaultBranch(repository: RepositoryCoordinates): Promise<string>;
  /** Every cache entry recorded against `ref`, across all pages. */
  listCaches(repository: RepositoryCoordinates, ref: string): Promise<CacheEntry[]>;
  /**
   * Deletes one entry by id.
   *
   * Resolves `not-found` when the entry is already gone, which is the outcome the caller wanted;
   * every other failure rejects.
   */
  deleteCache(repository: RepositoryCoordinates, id: number): Promise<DeleteOutcome>;
}

/** GitHub's ceiling on `per_page` for the cache list. */
const PAGE_SIZE = 100;

const NOT_FOUND = 404;

export function createCacheApi(token: string): CacheApi {
  const octokit = createOctokit(token);

  return {
    async deleteCache({ owner, repo }: RepositoryCoordinates, id: number): Promise<DeleteOutcome> {
      try {
        await octokit.rest.actions.deleteActionsCacheById({ cache_id: id, owner, repo });

        return 'deleted';
      } catch (error) {
        // Another run wiping the same branch, or GitHub evicting the entry, got there first.
        if (hasStatus(error, NOT_FOUND)) {
          return 'not-found';
        }
        throw error;
      }
    },

    async getDefaultBranch({ owner, repo }: RepositoryCoordinates): Promise<string> {
      const { data } = await octokit.rest.repos.get({ owner, repo });

      return data.default_branch;
    },

    async listCaches({ owner, repo }: RepositoryCoordinates, ref: string): Promise<CacheEntry[]> {
      const entries: CacheEntry[] = [];
      const pages = octokit.paginate.iterator(octokit.rest.actions.getActionsCacheList, {
        owner,
        per_page: PAGE_SIZE,
        ref,
        repo,
      });

      for await (const { data } of pages) {
        for (const cache of data) {
          // An entry without an id cannot be deleted, and one without a ref cannot be shown to
          // belong to this branch; neither is safe to act on.
          if (cache.id === undefined || cache.ref === undefined) {
            continue;
          }

          entries.push({ id: cache.id, key: cache.key ?? '', ref: cache.ref, sizeInBytes: cache.size_in_bytes ?? 0 });
        }
      }

      return entries;
    },
  };
}
