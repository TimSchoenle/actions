import * as core from '@actions/core';
import { parseRepository, quoteForLog, quoteUrlForLog, runAction, workspaceRoot } from 'actions-util';

import { resolveBody } from './body.js';
import {
  ActionInput,
  ActionOutput,
  getBooleanInput,
  getInput,
  getMultilineInput,
  setOutput,
} from './generated/action-io.js';
import { createIssueApi } from './github-api.js';
import { upsertIssue } from './upsert.js';

import type { IssueApi, IssueSearchState } from './issue-api.js';
import type { IssueOperation, UpsertOutcome } from './upsert.js';

/** What each outcome reads as in the step log. */
const OPERATION_MESSAGES: Record<IssueOperation, string> = {
  created: 'Opened a new issue',
  reopened: 'Reopened the existing issue',
  unchanged: 'Issue already said this; left it untouched',
  updated: 'Updated the existing issue',
};

/**
 * Validates `search_state` against the values GitHub's issue listing accepts, so a typo fails fast
 * with a message naming the input rather than surfacing later as an Octokit 422.
 */
function parseSearchState(value: string): IssueSearchState {
  if (value !== 'open' && value !== 'all') {
    throw new Error(`search_state must be 'open' or 'all', got ${quoteForLog(value)}`);
  }

  return value;
}

function report(outcome: UpsertOutcome): void {
  if (outcome.truncated) {
    core.warning('The issue body exceeded the size GitHub accepts and was cut short.');
  }

  if (outcome.fallbackReason !== undefined) {
    core.warning(`Falling back to a new issue: ${outcome.fallbackReason}.`);
  }

  core.info(`${OPERATION_MESSAGES[outcome.operation]}: ${quoteUrlForLog(outcome.issue.url)}`);
}

/**
 * Reads the action inputs and opens or updates the issue, replacing the one a previous run left
 * behind.
 *
 * @param api - injection seam for tests; defaults to the GitHub REST API bound to `token`.
 */
export function run(api?: IssueApi): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const identifier = getInput(ActionInput.identifier, { required: true });
    const title = getInput(ActionInput.title, { required: true });
    const repository = getInput(ActionInput.repository);
    const labels = getMultilineInput(ActionInput.labels);
    const updateExisting = getBooleanInput(ActionInput.update_existing);
    const searchState = parseSearchState(getInput(ActionInput.search_state));
    const reopenIfClosed = getBooleanInput(ActionInput.reopen_if_closed);
    const author = getInput(ActionInput.author);

    const body = await resolveBody(
      { body: getInput(ActionInput.body), bodyFile: getInput(ActionInput.body_file) },
      workspaceRoot(),
    );

    const target = parseRepository(repository);

    core.info(`Upserting issue ${quoteForLog(identifier)} on ${quoteForLog(repository)}.`);

    const outcome = await upsertIssue(api ?? createIssueApi(token), {
      author,
      body,
      identifier,
      labels,
      reopenIfClosed,
      searchState,
      target,
      title,
      updateExisting,
    });

    setOutput(ActionOutput.issue_number, String(outcome.issue.number));
    setOutput(ActionOutput.issue_url, outcome.issue.url);
    setOutput(ActionOutput.operation, outcome.operation);

    report(outcome);
  });
}
