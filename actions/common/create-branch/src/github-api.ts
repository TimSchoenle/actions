import * as github from '@actions/github';
import { hasStatus } from 'actions-util';

import type { BranchApi } from './create-branch.js';
import type { RepositoryCoordinates } from 'actions-util';

/**
 * Binds the {@link BranchApi} to the GitHub REST API.
 *
 * Refs are read through the exact-match `GET /git/ref/{ref}` endpoint, so `feature` cannot be
 * reported as existing merely because `feature/x` does. Only a missing ref is translated into
 * `undefined`; every other error (bad credentials, rate limit, server error) propagates, so it
 * cannot be misreported as a branch that does not exist and then overwritten.
 */
export function createBranchApi(token: string): BranchApi {
  const octokit = github.getOctokit(token);

  return {
    async createBranch({ owner, repo }: RepositoryCoordinates, branch: string, sha: string): Promise<void> {
      await octokit.rest.git.createRef({ owner, ref: `refs/heads/${branch}`, repo, sha });
    },

    async getBranchSha({ owner, repo }: RepositoryCoordinates, branch: string): Promise<string | undefined> {
      try {
        const { data } = await octokit.rest.git.getRef({ owner, ref: `heads/${branch}`, repo });
        return data.object.sha;
      } catch (error) {
        if (hasStatus(error, 404)) {
          return undefined;
        }
        throw error;
      }
    },

    async getDefaultBranch({ owner, repo }: RepositoryCoordinates): Promise<string> {
      const { data } = await octokit.rest.repos.get({ owner, repo });
      return data.default_branch;
    },

    async resetBranch({ owner, repo }: RepositoryCoordinates, branch: string, sha: string): Promise<void> {
      await octokit.rest.git.updateRef({ force: true, owner, ref: `heads/${branch}`, repo, sha });
    },
  };
}
