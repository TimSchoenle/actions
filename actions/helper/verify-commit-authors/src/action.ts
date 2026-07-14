import * as core from '@actions/core';

import { getInput, setOutput } from './generated/action-io.js';
import { fetchPullRequestCommits } from './github-api.js';
import { MAX_VERIFIABLE_COMMITS, parseUserIds, verifyCommits } from './verify.js';

import type { PullRequestCommits } from './github-api.js';
import type { VerificationResult } from './verify.js';

/** Fetches the commits of a pull request; injectable so the adapter can be tested without a network. */
export type CommitFetcher = (token: string, prUrl: string) => Promise<PullRequestCommits>;

function publish(result: Pick<VerificationResult, 'invalidCommits' | 'verified'>): void {
  setOutput('verified', String(result.verified));
  setOutput('invalid_commits', result.invalidCommits.join('\n'));
}

/**
 * Reads the action inputs, verifies every commit of the pull request and publishes the outputs.
 *
 * The action fails closed: anything that prevents a complete check — too many commits, incomplete
 * data, an API error — results in `verified=false` or a failed step, never in a silent pass.
 *
 * @param fetchCommits injection seam for tests; defaults to the GitHub GraphQL API.
 */
export async function run(fetchCommits: CommitFetcher = fetchPullRequestCommits): Promise<void> {
  try {
    const prUrl = getInput('pr_url', { required: true });
    const token = getInput('github_token', { required: true });
    const acceptedIds = parseUserIds(getInput('user_ids', { required: true }));

    core.info(`Verifying commits for PR: ${prUrl}`);
    core.info(`Accepted User IDs: ${acceptedIds.join(', ')}`);

    const { commits, totalCount } = await fetchCommits(token, prUrl);

    if (totalCount > MAX_VERIFIABLE_COMMITS) {
      core.warning(
        `Pull request has ${totalCount} commits, more than the ${MAX_VERIFIABLE_COMMITS} this action can verify. Reporting as unverified.`,
      );
      publish({ invalidCommits: [], verified: false });
      return;
    }

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
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}
