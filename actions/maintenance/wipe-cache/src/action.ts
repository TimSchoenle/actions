import { readFileSync } from 'node:fs';

import * as core from '@actions/core';
import { errorMessage, parseRepository, quoteForLog, runAction } from 'actions-util';

import { resolveBranch } from './branch.js';
import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createCacheApi } from './github-api.js';
import { renderSummary } from './summary.js';
import { wipeBranchCaches } from './wipe.js';

import type { CacheApi } from './github-api.js';

/** The parts of the triggering event this action inspects. */
export interface EventContext {
  /** `GITHUB_EVENT_NAME`, e.g. `delete`. */
  eventName: string | undefined;
  /** `ref_type` of a `create` or `delete` payload: `branch` or `tag`. */
  refType: string | undefined;
}

/**
 * Reads the event name and, for a `delete` event, the deleted ref's type.
 *
 * Read from the runner's environment rather than `@actions/github`'s context, which parses the
 * payload once at import time and so cannot be pointed at a test fixture afterwards.
 */
export function readEventContext(env: NodeJS.ProcessEnv = process.env): EventContext {
  const eventName = env['GITHUB_EVENT_NAME'];
  const eventPath = env['GITHUB_EVENT_PATH'];

  if (eventName !== 'delete' || eventPath === undefined || eventPath === '') {
    return { eventName, refType: undefined };
  }

  try {
    const payload = JSON.parse(readFileSync(eventPath, 'utf8')) as { ref_type?: unknown };

    return { eventName, refType: typeof payload.ref_type === 'string' ? payload.ref_type : undefined };
  } catch (error) {
    throw new Error(`Could not read the delete event payload at ${quoteForLog(eventPath)}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/** Appends to the job summary when the runner provides one; outside a runner there is nowhere to write. */
async function writeSummary(markdown: string): Promise<void> {
  if ((process.env['GITHUB_STEP_SUMMARY'] ?? '') === '') {
    return;
  }

  await core.summary.addRaw(markdown).write();
}

function publishCounts(matched: number, deleted: number, failed: number): void {
  setOutput(ActionOutput.matched_count, String(matched));
  setOutput(ActionOutput.deleted_count, String(deleted));
  setOutput(ActionOutput.failed_count, String(failed));
}

/**
 * Reads the action inputs, wipes the branch's caches and publishes the counts.
 *
 * A `delete` event for a tag is skipped with a notice before any input is validated: the event
 * fires for tags too, and its `ref` would otherwise be read as a branch of the same name.
 *
 * @param api injection seam for tests; defaults to the GitHub REST API bound to the `token` input.
 * @param event injection seam for tests; defaults to the runner's event.
 */
export function run(api?: CacheApi, event?: EventContext): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const { eventName, refType } = event ?? readEventContext();

    if (eventName === 'delete' && refType !== 'branch') {
      core.notice(`Skipping: the delete event removed a ${refType ?? 'ref of unknown type'}, not a branch.`);
      publishCounts(0, 0, 0);
      return;
    }

    const repositoryInput = getInput(ActionInput.repository, { required: true });
    const repository = parseRepository(repositoryInput);
    const target = resolveBranch(getInput(ActionInput.branch));
    const allowDefaultBranch = getBooleanInput(ActionInput.allow_default_branch);
    const dryRun = getBooleanInput(ActionInput.dry_run);
    const failOnError = getBooleanInput(ActionInput.fail_on_error);

    core.info(
      `${dryRun ? 'Listing' : 'Wiping'} the caches of ${quoteForLog(target.ref)} in ${quoteForLog(repositoryInput)}.`,
    );

    const result = await wipeBranchCaches(api ?? createCacheApi(token), {
      allowDefaultBranch,
      dryRun,
      repository,
      target,
    });

    core.info(
      `Done: ${result.matched.length} matched, ${result.deleted.length} deleted, ` +
        `${result.alreadyGone.length} already gone, ${result.failures.length} failed.`,
    );

    publishCounts(result.matched.length, result.deleted.length, result.failures.length);
    await writeSummary(renderSummary(result, repositoryInput, target.ref, dryRun));

    if (result.failures.length === 0) {
      return;
    }

    const failure = `${result.failures.length} cache entr(ies) could not be deleted`;

    if (failOnError) {
      core.setFailed(`${failure}.`);
      return;
    }

    core.warning(`${failure}; continuing because fail_on_error is false.`);
  });
}
