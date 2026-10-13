import { hasStatus, resolveExists } from 'actions-util';
import { createOctokit } from 'actions-util/client';

import type { PullRequestApi } from './close.js';
import type { RepositoryCoordinates } from 'actions-util';

/** GitHub's answer to an update it refuses on validation grounds. */
const UNPROCESSABLE = 422;

/**
 * Binds the {@link PullRequestApi} to the GitHub REST API.
 *
 * Only a missing pull request is translated into `false`; every other error (bad credentials, rate
 * limit, server error) propagates, so it cannot be misreported as a pull request that never existed.
 *
 * Comments are posted through the issues endpoint because GitHub models a pull request as an issue
 * with a branch: `pulls.createReviewComment` would attach the text to a line of the diff instead of
 * the conversation.
 */
export function createPullRequestApi(token: string): PullRequestApi {
  const octokit = createOctokit(token);

  return {
    async closePullRequest({ owner, repo }: RepositoryCoordinates, pullRequestNumber: number): Promise<void> {
      try {
        // The API accepts `state: closed` on an already-closed pull request and returns it unchanged,
        // so a re-run of the workflow does not fail.
        await octokit.rest.pulls.update({ owner, pull_number: pullRequestNumber, repo, state: 'closed' });
      } catch (error) {
        // Except when the base branch is gone: GitHub closes the pull request itself as the branch is
        // deleted, then refuses every update to it with a bare 422 "Validation Failed". The desired
        // end state is already reached, so a 422 is settled by reading the state back. Anything that
        // still reads as open is a genuine refusal and propagates.
        if (hasStatus(error, UNPROCESSABLE) && (await isClosed(owner, repo, pullRequestNumber))) {
          return;
        }
        throw error;
      }
    },

    async commentOnPullRequest(
      { owner, repo }: RepositoryCoordinates,
      pullRequestNumber: number,
      comment: string,
    ): Promise<void> {
      await octokit.rest.issues.createComment({ body: comment, issue_number: pullRequestNumber, owner, repo });
    },

    async pullRequestExists({ owner, repo }: RepositoryCoordinates, pullRequestNumber: number): Promise<boolean> {
      return resolveExists(octokit.rest.pulls.get({ owner, pull_number: pullRequestNumber, repo }));
    },
  };

  async function isClosed(owner: string, repo: string, pullRequestNumber: number): Promise<boolean> {
    const { data } = await octokit.rest.pulls.get({ owner, pull_number: pullRequestNumber, repo });

    return data.state === 'closed';
  }
}
