import * as github from '@actions/github';
import { hasStatus } from 'actions-common-ts-util';

import type { BranchApi } from './delete.js';
import type { RepositoryCoordinates } from 'actions-common-ts-util';

/** The Git ref a branch lives behind, e.g. `heads/main` for the branch `main`. */
function branchRef(branch: string): string {
  return `heads/${branch}`;
}

/**
 * Binds the {@link BranchApi} to the GitHub REST API.
 *
 * Existence is probed through the single-ref endpoint (`GET /git/ref/{ref}`), which matches the ref
 * exactly. The list endpoint (`GET /git/refs/{ref}`) prefix-matches instead, so it reports `feature`
 * as existing while only `feature-x` does — and the deletion that follows would then fail for a
 * branch nobody asked to delete.
 *
 * Only a missing branch is translated into `false`; every other error (bad credentials, rate limit,
 * server error) propagates, so it cannot be misreported as a missing branch. Deletion failures
 * propagate too — whether they are fatal is the caller's decision, not this layer's.
 */
export function createBranchApi(token: string): BranchApi {
  const octokit = github.getOctokit(token);

  return {
    async branchExists({ owner, repo }: RepositoryCoordinates, branch: string): Promise<boolean> {
      try {
        await octokit.rest.git.getRef({ owner, ref: branchRef(branch), repo });
        return true;
      } catch (error) {
        if (hasStatus(error, 404)) {
          return false;
        }
        throw error;
      }
    },

    async deleteBranch({ owner, repo }: RepositoryCoordinates, branch: string): Promise<void> {
      await octokit.rest.git.deleteRef({ owner, ref: branchRef(branch), repo });
    },
  };
}
