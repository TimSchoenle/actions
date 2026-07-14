import * as github from '@actions/github';
import { resolveExists } from 'actions-util';

import type { PullRequestApi } from './close.js';
import type { RepositoryCoordinates } from 'actions-util';

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
  const octokit = github.getOctokit(token);

  return {
    async closePullRequest({ owner, repo }: RepositoryCoordinates, pullRequestNumber: number): Promise<void> {
      // Idempotent by design: the API accepts `state: closed` on an already-closed pull request and
      // returns it unchanged, so a re-run of the workflow does not fail.
      await octokit.rest.pulls.update({ owner, pull_number: pullRequestNumber, repo, state: 'closed' });
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
}
