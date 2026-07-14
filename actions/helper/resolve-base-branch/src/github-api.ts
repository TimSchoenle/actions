import * as github from '@actions/github';

import type { BranchApi, RepositoryCoordinates } from './resolve.js';

/** Narrows an unknown error to an Octokit HTTP error carrying the given status. */
function hasStatus(error: unknown, status: number): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === status;
}

/**
 * Binds the {@link BranchApi} to the GitHub REST API.
 *
 * Only a missing branch is translated into `false`; every other error (bad credentials, rate limit,
 * server error) propagates, so it cannot be misreported as a missing branch.
 */
export function createBranchApi(token: string): BranchApi {
  const octokit = github.getOctokit(token);

  return {
    async branchExists({ owner, repo }: RepositoryCoordinates, branch: string): Promise<boolean> {
      try {
        await octokit.rest.repos.getBranch({ branch, owner, repo });
        return true;
      } catch (error) {
        if (hasStatus(error, 404)) {
          return false;
        }
        throw error;
      }
    },

    async getDefaultBranch({ owner, repo }: RepositoryCoordinates): Promise<string> {
      const { data } = await octokit.rest.repos.get({ owner, repo });
      return data.default_branch;
    },
  };
}
