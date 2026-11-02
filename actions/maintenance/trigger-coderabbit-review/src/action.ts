import * as core from '@actions/core';
import { parsePullRequestUrl, quoteForLog, runAction } from 'actions-util';

import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createTriggerApi } from './github-api.js';
import { parseCommand, parseLogins, triggerReview } from './trigger.js';

import type { TriggerApi } from './github-api.js';
import type { SkipReason } from './trigger.js';

/** Human-readable explanation of each skip reason, for the run log. */
const SKIP_MESSAGES: Record<SkipReason, string> = {
  'bot-author': 'the pull request was opened by a bot account',
  closed: 'the pull request is not open',
  draft: 'the pull request is a draft',
  fork: 'the head branch lives in a fork',
  'skipped-author': 'the pull request author is listed in skip_authors',
};

/**
 * Reads the action inputs, posts the CodeRabbit command when no skip rule applies and publishes the
 * outcome.
 *
 * Every input is validated before the first API call, so a typo in `command` fails the step without
 * touching the pull request.
 *
 * @param api - injection seam for tests; defaults to the GitHub REST API bound to `token`.
 */
export function run(api?: TriggerApi): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const pullRequest = parsePullRequestUrl(getInput(ActionInput.pr_url, { required: true }));
    const command = parseCommand(getInput(ActionInput.command, { required: true }));
    const skipDrafts = getBooleanInput(ActionInput.skip_drafts);
    const skipBots = getBooleanInput(ActionInput.skip_bots);
    const rejectForks = getBooleanInput(ActionInput.reject_forks);
    const skipAuthors = parseLogins(getInput(ActionInput.skip_authors));

    const outcome = await triggerReview(api ?? createTriggerApi(token), {
      command,
      pullRequest,
      rejectForks,
      skipAuthors,
      skipBots,
      skipDrafts,
    });

    const target = `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`;

    if (!outcome.triggered) {
      core.info(`Skipping ${target}: ${SKIP_MESSAGES[outcome.skipReason]}.`);
      setOutput(ActionOutput.triggered, 'false');
      setOutput(ActionOutput.skip_reason, outcome.skipReason);
      setOutput(ActionOutput.comment_url, '');
      return;
    }

    core.info(
      `Posted ${quoteForLog(`@coderabbitai ${command}`)} on ${target} as ${quoteForLog(outcome.actor)}: ${outcome.comment.url}`,
    );
    setOutput(ActionOutput.triggered, 'true');
    setOutput(ActionOutput.skip_reason, '');
    setOutput(ActionOutput.comment_url, outcome.comment.url);
  });
}
