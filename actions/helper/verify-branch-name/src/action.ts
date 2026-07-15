import * as core from '@actions/core';
import { runAction, verifyBranch } from 'actions-util';

import { getBooleanInput, getInput, setOutput } from './generated/action-io.js';

import type { BranchVerificationResult } from 'actions-util';

function reportFailure(result: BranchVerificationResult): void {
  core.error('Verification failed!');

  if (!result.branchPatternVerified) {
    core.error('  - Branch pattern check failed');
  }
  if (!result.forkVerified) {
    core.error('  - Fork check failed');
  }

  core.setFailed('Branch verification failed.');
}

/**
 * Reads the action inputs, runs the verification and publishes the outputs.
 *
 * The pull request inputs (`head_ref`, `head_repo_full_name`, `base_repo_full_name`) default to the
 * `pull_request` payload of the triggering event via expressions in `action.yaml`; they arrive here
 * already resolved. An empty value therefore means the workflow neither passed one nor ran on a pull
 * request, which `verifyBranch` rejects rather than silently treating as "not a fork".
 *
 * Outputs are always published — also on a failed verification — so that callers running with
 * `error_on_failure: false` can branch on the individual results.
 */
export function run(): void {
  runAction(() => {
    const branchPattern = getInput('branch_pattern');
    const rejectForks = getBooleanInput('reject_forks');
    const errorOnFailure = getBooleanInput('error_on_failure');
    const headRef = getInput('head_ref');
    const headRepoFullName = getInput('head_repo_full_name');
    const baseRepoFullName = getInput('base_repo_full_name');

    core.info(`Head branch: '${headRef}'`);
    core.info(`Head repository: '${headRepoFullName}'`);
    core.info(`Base repository: '${baseRepoFullName}'`);
    core.info(
      branchPattern === ''
        ? 'No branch pattern specified. Skipping pattern check (auto-pass).'
        : `Branch pattern: '${branchPattern}'`,
    );

    const result = verifyBranch({
      baseRepoFullName,
      branchPattern,
      headRef,
      headRepoFullName,
      rejectForks,
    });

    setOutput('verified', String(result.verified));
    setOutput('branch_pattern_verified', String(result.branchPatternVerified));
    setOutput('fork_verified', String(result.forkVerified));

    if (result.isFork) {
      core.info(
        rejectForks
          ? '✗ Pull request originates from a fork and forks are rejected.'
          : '✓ Pull request originates from a fork, which is allowed by configuration.',
      );
    }

    if (result.verified) {
      core.info('✅ Branch verified.');
      return;
    }

    if (errorOnFailure) {
      reportFailure(result);
      return;
    }

    core.warning('Branch verification did not pass. Continuing because error_on_failure is false.');
  });
}
