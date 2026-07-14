import * as core from '@actions/core';
import { runAction } from 'actions-util';
import { createBranchApi } from 'actions-util/branches';

import { deleteBranchIfExists } from './delete.js';
import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';

import type { BranchApi, DeleteResult } from './delete.js';

/**
 * Reports the outcome the way a caller reading the job log expects it.
 *
 * A failed deletion is a warning rather than a failure: this action cleans up after work that has
 * already succeeded, so a branch that survives — protected, or already gone by the time the delete
 * lands — must not fail the workflow. The `deleted` output tells a caller that needs certainty.
 */
function report(result: DeleteResult, repository: string, branch: string): void {
  switch (result.outcome) {
    case 'deleted': {
      core.info(`✅ Branch '${branch}' deleted successfully.`);
      break;
    }
    case 'delete-failed': {
      core.warning(`Failed to delete branch '${branch}': ${result.cause.message}`);
      break;
    }
    case 'not-found': {
      core.info(`Branch '${branch}' does not exist in ${repository}. Skipping delete.`);
      break;
    }
  }
}

/**
 * Reads the action inputs, deletes the branch and publishes the `deleted` output.
 *
 * Only a genuinely unusable request fails the step: a malformed `repository`, a missing
 * `branch_name`, or an existence probe that fails for any reason other than "not found" — an
 * unusable token must not be reported as an absent branch, which every caller here treats as
 * success.
 *
 * @param api injection seam for tests; defaults to the GitHub REST API bound to the `token` input.
 */
export function run(api?: BranchApi): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const repository = getInput(ActionInput.repository, { required: true });
    const branchName = getInput(ActionInput.branch_name, { required: true });

    core.info(`Attempting to delete branch '${branchName}' in repository: ${repository}`);

    const result = await deleteBranchIfExists(api ?? createBranchApi(token), { branchName, repository });

    report(result, repository, branchName);

    setOutput(ActionOutput.deleted, String(result.deleted));
  });
}
