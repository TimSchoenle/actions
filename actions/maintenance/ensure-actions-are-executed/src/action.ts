import * as core from '@actions/core';
import { parseRepository, runAction } from 'actions-util';

import { collectCheckRuns, latestCheckRuns } from './checks.js';
import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createCheckRunsApi } from './github-api.js';
import { normalizeMatchers, parseMatchMode, resolveMatcher, selectChecks } from './matchers.js';
import { verifyCheckRuns } from './verification.js';

import type { CheckRun, CheckRunCollection, CheckRunsApi } from './checks.js';
import type { Matcher, Selection } from './matchers.js';
import type { VerificationSummary } from './verification.js';

/** Emits a collapsible log group, closing it even when the body throws. */
function group(title: string, body: () => void): void {
  core.startGroup(title);
  try {
    body();
  } finally {
    core.endGroup();
  }
}

/**
 * Identifies the workflow run whose jobs stand in for check runs when the ref has none.
 *
 * Absent or unparsable outside of a workflow run — in which case there is no fallback to attempt, and
 * `collectCheckRuns` says so instead of guessing a run id.
 */
function currentRunId(): number | undefined {
  const runId = Number(process.env.GITHUB_RUN_ID);

  return Number.isSafeInteger(runId) && runId > 0 ? runId : undefined;
}

function logSnapshot(collection: CheckRunCollection, checkRuns: CheckRun[]): void {
  if (collection.fallbackFailure !== undefined) {
    core.notice(collection.fallbackFailure);
  }

  group(`Latest Check Snapshot (${checkRuns.length})`, () => {
    core.info(`Data source: ${collection.source}`);
    core.info(`Fetched check runs: ${collection.checkRuns.length}`);

    if (checkRuns.length === 0) {
      core.info('No checks found in the selected data source.');
      return;
    }

    for (const [index, checkRun] of checkRuns.entries()) {
      const conclusion = checkRun.conclusion ?? 'null';

      core.info(`${index + 1}. ${checkRun.name} (status=${checkRun.status}, conclusion=${conclusion})`);
    }
  });
}

function logSelection(selection: Selection): void {
  group('Matcher Evaluation', () => {
    for (const { matcher, matchedNames } of selection.outcomes) {
      core.info(`Matcher '${matcher.raw}' mode=${matcher.mode} matched=${matchedNames.length}`);
    }
  });

  for (const { matcher, matchedNames } of selection.outcomes) {
    core.notice(
      matchedNames.length === 0
        ? `Matcher '${matcher.raw}' did not match any check run. This is treated as not started.`
        : `Matcher '${matcher.raw}' matched ${matchedNames.length} check run(s).`,
    );
  }

  if (selection.selected.length === 0) {
    core.notice('No checks were selected by the provided matchers.');
    return;
  }

  group(`Selected Checks (${selection.selected.length})`, () => {
    for (const [index, checkRun] of selection.selected.entries()) {
      core.info(`${index + 1}. ${checkRun.name}`);
    }
  });
}

function logVerification(summary: VerificationSummary): void {
  if (summary.verifications.length === 0) {
    core.notice('No matched checks to verify.');
    return;
  }

  group('Verify Matched Checks', () => {
    for (const { checkRun, outcome, reason } of summary.verifications) {
      core.info(`Check '${checkRun.name}' => status=${checkRun.status} conclusion=${checkRun.conclusion ?? 'null'}`);

      // A failure is annotated with its details URL, so the log points straight at the run to open.
      if (outcome === 'failed') {
        core.error(checkRun.detailsUrl === null ? reason : `${reason} ${checkRun.detailsUrl}`);
      } else {
        core.notice(reason);
      }
    }
  });
}

function logSummary(summary: VerificationSummary, matchedCount: number, errorOnFailure: boolean): void {
  group('Final Summary', () => {
    core.info(`Matched checks: ${matchedCount}`);
    core.info(`Successful checks: ${summary.succeededCount}`);
    core.info(`Skipped checks: ${summary.skippedCount}`);
    core.info(`Failed checks: ${summary.failedCount}`);
    core.info(`Error on failure: ${String(errorOnFailure)}`);
  });
}

/**
 * Reads the action inputs, verifies every check the matchers select and publishes the counts.
 *
 * The contract is "checks that started must have succeeded": a matcher selecting nothing is a check
 * that never started, which is tolerated, while a selected check that is unfinished or unsuccessful is
 * a failure. `error_on_failure=false` downgrades that failure to a warning, leaving the counts for the
 * caller to act on.
 *
 * @param api injection seam for tests; defaults to the GitHub REST API bound to the `token` input.
 */
export function run(api?: CheckRunsApi): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const checks = getInput(ActionInput.checks, { required: true });
    const matchMode = parseMatchMode(getInput(ActionInput.match_mode));
    const repository = parseRepository(getInput(ActionInput.repository));
    const ref = getInput(ActionInput.ref);
    const errorOnFailure = getBooleanInput(ActionInput.error_on_failure);

    if (ref === '') {
      throw new Error("No ref to inspect. Provide a git reference in 'ref'.");
    }

    const matchers: Matcher[] = normalizeMatchers(checks).map((raw) => resolveMatcher(raw, matchMode));

    group('Configuration', () => {
      core.info(`Repository: ${repository.owner}/${repository.repo}`);
      core.info(`Ref: ${ref}`);
      core.info(`Match mode: ${matchMode}`);
      core.info(`Error on failure: ${String(errorOnFailure)}`);
      core.info(`Matchers: ${matchers.map((matcher) => matcher.raw).join(', ')}`);
    });

    const collection = await collectCheckRuns(api ?? createCheckRunsApi(token), {
      ref,
      repository,
      runId: currentRunId(),
    });
    const checkRuns = latestCheckRuns(collection.checkRuns);

    logSnapshot(collection, checkRuns);

    if (checkRuns.length === 0) {
      core.notice(`No checks were available for matching in ${repository.owner}/${repository.repo} at ref ${ref}.`);
    }

    const selection = selectChecks(checkRuns, matchers);
    logSelection(selection);

    const summary = verifyCheckRuns(selection.selected);
    logVerification(summary);
    logSummary(summary, selection.selected.length, errorOnFailure);

    setOutput(ActionOutput.matched_checks_count, String(selection.selected.length));
    setOutput(ActionOutput.failed_checks_count, String(summary.failedCount));

    if (summary.failedCount === 0) {
      return;
    }

    const failure = `Verification failed because ${summary.failedCount} check(s) did not pass`;

    if (errorOnFailure) {
      core.setFailed(`${failure} and error_on_failure=true.`);
      return;
    }

    core.warning(`Found ${summary.failedCount} failing check(s), but continuing because error_on_failure=false.`);
  });
}
