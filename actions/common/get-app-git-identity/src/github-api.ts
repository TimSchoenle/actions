import * as github from '@actions/github';
import { resolveOptional } from 'actions-util';

import type { AppUserApi } from 'actions-util';

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
      const response = await resolveOptional(octokit.rest.users.getByUsername({ username }));

      return response?.data.id;
    },
  };
}
