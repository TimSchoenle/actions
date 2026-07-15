import * as core from '@actions/core';
import { runAction } from 'actions-util';

import { autoApprove } from './approve.js';
import { ActionInput, getBooleanInput, getInput } from './generated/action-io.js';
import { createAutoApproveApi } from './github-api.js';

import type { AutoApproveOutcome, SkipReason } from './approve.js';
import type { AutoApproveApi } from './github-api.js';

/** Human-readable explanation of each skip reason, for the run log. */
const SKIP_MESSAGES: Record<SkipReason, string> = {
  'author-not-accepted': 'the pull request author is not in the accepted list',
  'branch-unverified': 'the branch pattern or fork check did not pass',
  'commits-unverified': 'one or more commits failed the author or signature check',
  'no-changes': 'the pull request changes no files',
};

function report(outcome: AutoApproveOutcome): void {
  if (outcome.approved) {
    core.info('✅ All checks passed. Pull request approved.');
    return;
  }

  core.info(`Skipping auto-approval: ${SKIP_MESSAGES[outcome.skipReason ?? 'author-not-accepted']}.`);
}

/**
 * Reads the action inputs, decides whether the pull request may be auto-approved and approves it when
 * every check passes.
 *
 * @param api injection seam for tests; defaults to the GitHub REST and GraphQL APIs bound to `token`.
 */
export function run(api?: AutoApproveApi): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const userIds = getInput(ActionInput.user_ids, { required: true });
    const branchPattern = getInput(ActionInput.branch_pattern, { required: true });
    const prUrl = getInput(ActionInput.pr_url);
    const rejectForks = getBooleanInput(ActionInput.reject_forks);
    const ignoreEmptyPrs = getBooleanInput(ActionInput.ignore_empty_prs);
    const approveMessage = getInput(ActionInput.auto_approve_message);

    const outcome = await autoApprove(api ?? createAutoApproveApi(token), {
      approveMessage,
      branchPattern,
      ignoreEmptyPrs,
      prUrl,
      rejectForks,
      userIds,
    });

    report(outcome);
  });
}
