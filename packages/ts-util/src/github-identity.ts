import * as github from '@actions/github';

import { resolveOptional } from './github.js';

import type { AppUserApi } from './identity.js';

/**
 * Binds the {@link AppUserApi} to the GitHub REST API.
 *
 * Lives behind the `actions-util/identity` entry point rather than the package barrel: importing
 * Octokit has side effects the bundler cannot shake out, so only the actions that actually resolve a
 * bot user pull it in. See the note in `index.ts`.
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
