import * as core from '@actions/core';

import { ActionInput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createBranchApi } from './github-api.js';
import { BranchNotFoundError, resolveBaseBranch } from './resolve.js';

import type { BranchApi } from './resolve.js';

/**
 * Reads the action inputs, resolves the base branch and publishes the `base_branch` output.
 *
 * `silent_fail` only silences a branch that does not exist. Authentication, permission and transport
 * errors always fail the step — reporting them as "branch not found" would send callers down a
 * branch-creation path with a token that cannot create anything.
 *
 * @param api injection seam for tests; defaults to the GitHub REST API bound to the `token` input.
 */
export async function run(api?: BranchApi): Promise<void> {
  try {
    const token = getInput(ActionInput.token, { required: true });
    const repository = getInput(ActionInput.repository, { required: true });
    const branchName = getInput(ActionInput.branch_name);
    const checkIfExist = getBooleanInput(ActionInput.check_if_exist);
    const silentFail = getBooleanInput(ActionInput.silent_fail);

    try {
      const result = await resolveBaseBranch(api ?? createBranchApi(token), {
        branchName,
        checkIfExist,
        repository,
      });

      core.info(
        result.origin === 'input'
          ? `Using provided base branch: ${result.branch}`
          : `Using default branch: ${result.branch}`,
      );
      if (result.exists) {
        core.info(`✅ Branch '${result.branch}' exists in ${repository}`);
      }

      setOutput('base_branch', result.branch);
    } catch (error) {
      if (error instanceof BranchNotFoundError && silentFail) {
        core.warning(`${error.message}. Continuing because silent_fail is true.`);
        setOutput('base_branch', '');
        return;
      }

      throw error;
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}
