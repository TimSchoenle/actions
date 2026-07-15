import * as core from '@actions/core';
import { parseUserIds, runAction, verifyCommits } from 'actions-util';
import { fetchPullRequestCommits } from 'actions-util/commits';

import { getInput, setOutput } from './generated/action-io.js';

import type { VerificationResult } from 'actions-util';
import type { PullRequestCommits } from 'actions-util/commits';

/** Fetches the commits of a pull request; injectable so the adapter can be tested without a network. */
export type CommitFetcher = (token: string, prUrl: string) => Promise<PullRequestCommits>;

function publish(result: Pick<VerificationResult, 'invalidCommits' | 'verified'>): void {
  setOutput('verified', String(result.verified));
  setOutput('invalid_commits', result.invalidCommits.join('\n'));
}

/**
 * Reads the action inputs, verifies every commit of the pull request and publishes the outputs.
 *
 * The action fails closed: anything that prevents a complete check — incomplete data, an API error —
 * results in `verified=false` or a failed step, never in a silent pass.
 *
 * @param fetchCommits injection seam for tests; defaults to the GitHub GraphQL API.
 */
export function run(fetchCommits: CommitFetcher = fetchPullRequestCommits): Promise<void> {
  return runAction(async () => {
    const prUrl = getInput('pr_url', { required: true });
    const token = getInput('github_token', { required: true });
    const acceptedIds = parseUserIds(getInput('user_ids', { required: true }));

    core.info(`Verifying commits for PR: ${prUrl}`);
    core.info(`Accepted User IDs: ${acceptedIds.join(', ')}`);

    const { commits } = await fetchCommits(token, prUrl);

    const result = verifyCommits(commits, acceptedIds);

    for (const failure of result.failures) {
      core.error(`Invalid commit ${failure.oid}: ${failure.reasons.join('; ')}.`);
    }

    if (result.verified) {
      core.info(`All ${commits.length} commit(s) verified.`);
    } else {
      core.warning(
        commits.length === 0
          ? 'Pull request reports no commits. Reporting as unverified.'
          : `Found ${result.invalidCommits.length} invalid commit(s) (author check or signature check failed).`,
      );
    }

    publish(result);
  });
}
