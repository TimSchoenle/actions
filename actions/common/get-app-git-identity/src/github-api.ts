import * as github from '@actions/github';

import type { AppUserApi } from './identity.js';

/** Narrows an unknown error to an Octokit HTTP error carrying the given status. */
function hasStatus(error: unknown, status: number): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === status;
}

/**
 * Binds the {@link AppUserApi} to the GitHub REST API.
 *
 * Only a 404 becomes `undefined`; every other error (bad credentials, rate limit, server error)
 * propagates, so an unusable token cannot be misreported as a wrong app slug — the two demand
 * opposite fixes.
 */
export function createAppUserApi(token: string): AppUserApi {
  const octokit = github.getOctokit(token);

  return {
    async getUserId(username: string): Promise<number | undefined> {
      try {
        const { data } = await octokit.rest.users.getByUsername({ username });
        return data.id;
      } catch (error) {
        if (hasStatus(error, 404)) {
          return undefined;
        }
        throw error;
      }
    },
  };
}
