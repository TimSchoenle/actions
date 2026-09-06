import * as core from '@actions/core';
import { parsePullRequestUrl, quoteForLog, quoteUrlForLog, runAction, workspaceRoot } from 'actions-util';

import { resolveBody } from './body.js';
import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createCommentApi } from './github-api.js';
import { upsertComment } from './upsert.js';

import type { CommentApi } from './comment-api.js';
import type { CommentOperation, UpsertOutcome } from './upsert.js';

/** What each outcome reads as in the step log. */
const OPERATION_MESSAGES: Record<CommentOperation, string> = {
  created: 'Posted a new comment',
  unchanged: 'Comment already said this; left it untouched',
  updated: 'Updated the existing comment',
};

function report(outcome: UpsertOutcome): void {
  if (outcome.truncated) {
    core.warning('The comment body exceeded the size GitHub accepts and was cut short.');
  }

  if (outcome.fallbackReason !== undefined) {
    core.warning(`Falling back to a new comment: ${outcome.fallbackReason}.`);
  }

  core.info(`${OPERATION_MESSAGES[outcome.operation]}: ${quoteUrlForLog(outcome.comment.url)}`);
}

/**
 * Reads the action inputs and posts the comment, updating the one a previous run left behind.
 *
 * @param api - injection seam for tests; defaults to the GitHub REST API bound to `token`.
 */
export function run(api?: CommentApi): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const identifier = getInput(ActionInput.identifier, { required: true });
    const prUrl = getInput(ActionInput.pr_url);
    const updateExisting = getBooleanInput(ActionInput.update_existing);
    const author = getInput(ActionInput.author);

    const body = await resolveBody(
      { body: getInput(ActionInput.body), bodyFile: getInput(ActionInput.body_file) },
      workspaceRoot(),
    );

    const target = parsePullRequestUrl(prUrl);

    core.info(`Upserting comment ${quoteForLog(identifier)} on pull request #${target.number}.`);

    const outcome = await upsertComment(api ?? createCommentApi(token), {
      author,
      body,
      identifier,
      target,
      updateExisting,
    });

    setOutput(ActionOutput.comment_id, String(outcome.comment.id));
    setOutput(ActionOutput.comment_url, outcome.comment.url);
    setOutput(ActionOutput.operation, outcome.operation);

    report(outcome);
  });
}
