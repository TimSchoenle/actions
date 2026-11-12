import { errorMessage, parseRepository, parseUserIds, quoteForLog, runAction } from 'actions-util';
import * as core from 'actions-util/core';

import { createBranchMatcher, parsePatternMode } from './branch-pattern.js';
import { resolveMinimumOpenTime } from './duration.js';
import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createTimedAutoMergeApi } from './github-api.js';
import { parseMergeMethod } from './merge-method.js';
import { processPullRequests } from './process.js';
import { renderSummary, toOutputs } from './report.js';

import type { TimedAutoMergeApi } from './github-api.js';
import type { PullRequestOutcome, TimedAutoMergeRequest } from './process.js';

/** Ambient dependencies, injected so tests need neither the network nor a clock. */
export interface RunDependencies {
  api?: TimedAutoMergeApi;
  now?: () => number;
}

/** @throws naming the input, since the shared parser's message names a different one. */
function readUserIds(value: string, input: string): number[] {
  try {
    return parseUserIds(value);
  } catch (error) {
    throw new Error(`Invalid '${input}': ${errorMessage(error)}`, { cause: error });
  }
}

/** Reads and validates every input before any API call, so a misconfiguration changes nothing. */
function readRequest(nowMs: number): { token: string; failOnError: boolean; request: TimedAutoMergeRequest } {
  const token = getInput(ActionInput.token, { required: true });
  const trustedAuthorIds = readUserIds(getInput(ActionInput.trusted_authors, { required: true }), 'trusted_authors');
  const prAuthorInput = getInput(ActionInput.pr_author_ids);
  const prAuthorIds = prAuthorInput === '' ? trustedAuthorIds : readUserIds(prAuthorInput, 'pr_author_ids');
  const baseBranch = getInput(ActionInput.base_branch);
  const patternMode = parsePatternMode(getInput(ActionInput.pattern_mode));
  const matcher = createBranchMatcher(getInput(ActionInput.branch_pattern), patternMode);
  const minimumOpen = resolveMinimumOpenTime(getInput(ActionInput.time_elapsed), getInput(ActionInput.minimum_age));
  const mergeMethod = parseMergeMethod(getInput(ActionInput.merge_method));
  const repository = parseRepository(getInput(ActionInput.repository));
  const approveMessage = getInput(ActionInput.approve_message);
  const failOnError = getBooleanInput(ActionInput.fail_on_error);

  if (approveMessage.trim() === '') {
    throw new Error("'approve_message' must not be empty.");
  }

  core.startGroup('Configuration');
  core.info(`Repository: ${repository.owner}/${repository.repo}`);
  core.info(`Branch pattern (${patternMode}): ${quoteForLog(matcher.source)}`);
  core.info(`Base branch: ${baseBranch === '' ? 'any' : quoteForLog(baseBranch)}`);
  core.info(`Soak time since opening and since the newest commit: ${minimumOpen.text}`);
  core.info(`Merge method: ${mergeMethod}`);
  core.info(`Trusted authors: ${trustedAuthorIds.join(', ')}`);
  core.info(`Pull request authors: ${prAuthorIds.join(', ')}`);
  core.endGroup();

  return {
    failOnError,
    request: {
      approveMessage,
      baseBranch,
      matcher,
      mergeMethod,
      minimumOpenMs: minimumOpen.milliseconds,
      nowMs,
      prAuthorIds,
      repository,
      trustedAuthorIds,
    },
    token,
  };
}

function logOutcome(outcome: PullRequestOutcome): void {
  const prefix = `#${outcome.number} ${quoteForLog(outcome.headRef)}`;

  switch (outcome.status) {
    case 'approved': {
      const merge = outcome.merge === 'merged' ? 'merged, since it was already mergeable' : 'auto-merge enabled';

      core.info(`${prefix}: approved at ${outcome.headSha} and ${merge}.`);
      break;
    }
    case 'skipped': {
      core.info(`${prefix}: skipped (${outcome.reason}): ${quoteForLog(outcome.detail)}`);
      break;
    }
    case 'failed': {
      core.error(`${prefix}: ${quoteForLog(outcome.message)}`);
      break;
    }
  }
}

/**
 * Reads the inputs, approves and enables auto-merge on every eligible pull request, and publishes
 * what happened to each matching one.
 *
 * Skipping a pull request is a normal outcome. Only a failed API call counts against the step, and
 * only once every pull request has been processed; `fail_on_error: false` turns it into a warning.
 */
export function run(dependencies: RunDependencies = {}): Promise<void> {
  return runAction(async () => {
    const { failOnError, request, token } = readRequest((dependencies.now ?? Date.now)());
    const api = dependencies.api ?? createTimedAutoMergeApi(token);

    const report = await processPullRequests(api, request);

    core.startGroup(`Matching pull requests (${report.outcomes.length} of ${report.openCount} open)`);
    for (const outcome of report.outcomes) {
      logOutcome(outcome);
    }
    core.endGroup();

    const outputs = toOutputs(report.outcomes);
    setOutput(ActionOutput.approved, outputs.approved);
    setOutput(ActionOutput.skipped, outputs.skipped);
    setOutput(ActionOutput.failed, outputs.failed);

    await core.summary.addRaw(renderSummary(report, request.matcher.source)).write();

    const failedCount = report.outcomes.filter((outcome) => outcome.status === 'failed').length;

    if (failedCount === 0) {
      return;
    }

    const message = `${failedCount} pull request(s) could not be processed because an API call failed.`;

    if (failOnError) {
      throw new Error(message);
    }

    core.warning(`${message} Continuing because fail_on_error is false.`);
  });
}
