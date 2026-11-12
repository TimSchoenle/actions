import { parseRepository, quoteForLog, runAction } from 'actions-util';
import * as core from 'actions-util/core';

import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createUpdateBranchApi } from './github-api.js';
import { renderSummary } from './summary.js';
import { updateLabelledPullRequests } from './update.js';

import type { UpdateBranchApi } from './github-api.js';
import type { UpdateResult } from './update.js';

/** A positive whole number in plain decimal, with no sign, exponent or leading zero. */
const POSITIVE_INTEGER = /^[1-9]\d{0,8}$/;

/** Parses the `limit` input: empty means no limit, anything else must be a positive whole number. */
export function parseLimit(value: string): number | undefined {
  const trimmed = value.trim();

  if (trimmed === '') {
    return undefined;
  }

  if (!POSITIVE_INTEGER.test(trimmed)) {
    throw new Error(`Input limit must be a positive whole number or empty, got ${quoteForLog(value)}.`);
  }

  return Number(trimmed);
}

/** Appends to the job summary when the runner provides one; outside a runner there is nowhere to write. */
async function writeSummary(markdown: string): Promise<void> {
  if ((process.env['GITHUB_STEP_SUMMARY'] ?? '') === '') {
    return;
  }

  await core.summary.addRaw(markdown).write();
}

function publish(result: UpdateResult): void {
  setOutput(ActionOutput.updated, JSON.stringify(result.updated));
  setOutput(ActionOutput.skipped, JSON.stringify(result.skipped.map(({ number }) => number)));
  setOutput(ActionOutput.failed, JSON.stringify(result.failed.map(({ number }) => number)));
}

/**
 * Reads the action inputs, requests an update for the open pull requests carrying the label that
 * qualify, oldest first, and publishes the three lists.
 *
 * A rejected update (a 422: a conflict, a moved head) is a warning: the label marks pull requests to
 * keep current, and one that conflicts needs a person, not a red maintenance job. Any other failure
 * fails the step unless `fail_on_error` is false, because it usually means the token cannot write
 * to the repository and no pull request will ever be updated.
 *
 * @param api injection seam for tests; defaults to the GitHub REST API bound to the `token` input.
 */
export function run(api?: UpdateBranchApi): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const label = getInput(ActionInput.label, { required: true });
    const repositoryInput = getInput(ActionInput.repository, { required: true });
    const repository = parseRepository(repositoryInput);
    const skipDrafts = getBooleanInput(ActionInput.skip_drafts);
    const onlyAutoMerge = getBooleanInput(ActionInput.only_auto_merge);
    const limit = parseLimit(getInput(ActionInput.limit));
    const failOnError = getBooleanInput(ActionInput.fail_on_error);

    core.info(`Updating open pull requests labelled ${quoteForLog(label)} in ${quoteForLog(repositoryInput)}.`);

    const result = await updateLabelledPullRequests(api ?? createUpdateBranchApi(token), {
      label,
      limit,
      onlyAutoMerge,
      repository,
      skipDrafts,
    });

    core.info(
      `Done: ${result.updated.length} updated, ${result.skipped.length} skipped, ${result.failed.length} failed.`,
    );

    if (result.matched.length === 0) {
      core.notice(`No open pull request carries the label ${quoteForLog(label)}.`);
    }

    publish(result);
    await writeSummary(renderSummary(result, repositoryInput, label));

    const errors = result.failed.filter(({ kind }) => kind === 'error');

    if (errors.length === 0) {
      return;
    }

    const numbers = errors.map(({ number }) => `#${number}`).join(', ');

    if (failOnError) {
      core.setFailed(`The update of ${numbers} failed with an unexpected error.`);
      return;
    }

    core.warning(
      `The update of ${numbers} failed with an unexpected error; continuing because fail_on_error is false.`,
    );
  });
}
