import * as core from '@actions/core';
import { runAction } from 'actions-util';

import { closePullRequestIfPresent } from './close.js';
import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { createPullRequestApi } from './github-api.js';

import type { PullRequestApi } from './close.js';

/**
 * Reads the action inputs, closes the pull request and publishes the `closed` output.
 *
 * A pull request that does not exist is reported as `closed=false` without failing the step: callers
 * run this action to guarantee a pull request is gone, and one that was never opened — or was already
 * cleaned up — satisfies that. Everything else fails the step, including a pull request that exists
 * but cannot be closed: reporting a missing permission as `closed=false` would let a caller delete
 * the branch of a pull request that is still open.
 *
 * @param api injection seam for tests; defaults to the GitHub REST API bound to the `token` input.
 */
export function run(api?: PullRequestApi): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const repository = getInput(ActionInput.repository, { required: true });
    const pullRequestId = getInput(ActionInput.pull_request_id, { required: true });
    const comment = getInput(ActionInput.comment);

    const result = await closePullRequestIfPresent(api ?? createPullRequestApi(token), {
      comment,
      pullRequestId,
      repository,
    });

    core.info(
      result.closed
        ? `Successfully closed PR #${result.pullRequestNumber} ${result.commented ? 'with' : 'without'} comment`
        : `PR #${result.pullRequestNumber} not found or not accessible, skipping close.`,
    );

    setOutput(ActionOutput.closed, String(result.closed));
  });
}
