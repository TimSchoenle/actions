import * as core from '@actions/core';
import { runAction } from 'actions-util';

import { createOrResetBranch } from './create-branch.js';
import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createBranchApi } from './github-api.js';

import type { BranchApi, CreateBranchResult } from './create-branch.js';

/** Reports what the run did to the target branch, mirroring the log trail of the previous shell steps. */
function report(result: CreateBranchResult): void {
  core.info(
    result.baseOrigin === 'input'
      ? `Using provided base branch: ${result.baseBranch}`
      : `Using default branch: ${result.baseBranch}`,
  );
  core.info(`Base SHA: ${result.baseSha}`);

  switch (result.outcome) {
    case 'created': {
      core.info(`✅ Created branch '${result.branch}' at ${result.sha}`);
      break;
    }
    case 'reset': {
      core.info(`✅ Reset branch '${result.branch}' to ${result.sha}`);
      break;
    }
    case 'unchanged': {
      core.info(`Branch '${result.branch}' already exists at ${result.sha} and was not reset.`);
      break;
    }
  }
}

/**
 * Reads the action inputs, creates or resets the branch and publishes the resulting refs.
 *
 * `created` reports whether the branch was moved to the base commit — by creating it or by
 * resetting it — so a caller can tell a fresh branch from one it must not assume is empty.
 *
 * @param api injection seam for tests; defaults to the GitHub REST API bound to the `token` input.
 */
export function run(api?: BranchApi): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const repository = getInput(ActionInput.repository, { required: true });
    const branchName = getInput(ActionInput.branch_name, { required: true });
    const baseBranch = getInput(ActionInput.base_branch);
    const resetBranch = getBooleanInput(ActionInput.reset_branch);

    const result = await createOrResetBranch(api ?? createBranchApi(token), {
      baseBranch,
      branchName,
      repository,
      resetBranch,
    });

    report(result);

    setOutput(ActionOutput.branch, result.branch);
    setOutput(ActionOutput.base_branch, result.baseBranch);
    setOutput(ActionOutput.sha, result.sha);
    setOutput(ActionOutput.created, result.outcome === 'unchanged' ? 'false' : 'true');
  });
}
