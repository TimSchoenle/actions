import { parseUserIds, quoteForLog, quoteUrlForLog, runAction, verifyCommits } from 'actions-util';
import { fetchPullRequestCommits } from 'actions-util/commits';
import * as core from 'actions-util/core';

import { getBooleanInput, getInput, setOutput } from './generated/action-io.js';

import type { PullRequestCommits } from 'actions-util/commits';

/** Fetches the commits of a pull request; injectable so the adapter can be tested without a network. */
export type CommitFetcher = (token: string, prUrl: string) => Promise<PullRequestCommits>;

/** The verdict the action publishes. */
interface Verdict {
  verified: boolean;
  invalidCommits: readonly string[];
  headSha: string;
}

function publish({ verified, invalidCommits, headSha }: Verdict): void {
  setOutput('verified', String(verified));
  setOutput('invalid_commits', invalidCommits.join('\n'));
  setOutput('head_sha', headSha);
}

/**
 * Why a pull request is rejected for where its head lives, or `undefined` when it is not.
 *
 * A deleted head repository is rejected too: GitHub reports it as cross-repository with no name, and
 * where its commits came from can no longer be told.
 */
function forkRejection({ headRepository, isCrossRepository }: PullRequestCommits): string | undefined {
  if (headRepository === null) {
    return 'The head repository of this pull request no longer exists. Reporting as unverified.';
  }

  if (isCrossRepository) {
    return `The head branch lives in the fork ${quoteForLog(headRepository)}. Reporting as unverified.`;
  }

  return undefined;
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
    const rejectForks = getBooleanInput('reject_forks');

    core.info(`Verifying commits for PR: ${quoteUrlForLog(prUrl)}`);
    core.info(`Accepted User IDs: ${acceptedIds.join(', ')}`);

    const pullRequest = await fetchCommits(token, prUrl);
    const { commits, headOid } = pullRequest;

    const result = verifyCommits(commits, acceptedIds);

    for (const failure of result.failures) {
      core.error(`Invalid commit ${failure.oid}: ${failure.reasons.join('; ')}.`);
    }

    const rejection = rejectForks ? forkRejection(pullRequest) : undefined;

    if (rejection !== undefined) {
      core.warning(rejection);
    } else if (result.verified) {
      core.info(`All ${commits.length} commit(s) verified at ${headOid}.`);
    } else {
      core.warning(
        commits.length === 0
          ? 'Pull request reports no commits. Reporting as unverified.'
          : `Found ${result.invalidCommits.length} invalid commit(s) (author, committer or signature check failed).`,
      );
    }

    publish({
      headSha: headOid,
      invalidCommits: result.invalidCommits,
      verified: result.verified && rejection === undefined,
    });
  });
}
