import { parseRepository, quoteAllForLog, quoteForLog, runAction } from 'actions-util';
import * as core from 'actions-util/core';

import { collectCheckRuns, latestCheckRuns } from './checks.js';
import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createCheckRunsApi } from './github-api.js';
import { normalizeMatchers, parseMatchMode, resolveMatcher, selectChecks } from './matchers.js';
import { verifyCheckRuns } from './verification.js';

import type { CheckRun, CheckRunCollection, CheckRunsApi } from './checks.js';
import type { Matcher, MatcherOutcome, Selection } from './matchers.js';
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

      core.info(`${index + 1}. ${quoteForLog(checkRun.name)} (status=${checkRun.status}, conclusion=${conclusion})`);
    }
  });
}

/**
 * The required matchers that matched no check run.
 *
 * A required check without a run has either not started or not been created yet. Treating it as "not
 * started", as an optional matcher is, would let the gate pass before the check was even queued.
 */
function missingRequired(requiredOutcomes: readonly MatcherOutcome[]): MatcherOutcome[] {
  return requiredOutcomes.filter((outcome) => outcome.matchedNames.length === 0);
}

function logSelection(selection: Selection, requiredOutcomes: readonly MatcherOutcome[]): void {
  group('Matcher Evaluation', () => {
    for (const { matcher, matchedNames } of selection.outcomes) {
      const kind = requiredOutcomes.some((outcome) => outcome.matcher === matcher) ? ' required' : '';

      core.info(`Matcher ${quoteForLog(matcher.raw)}${kind} mode=${matcher.mode} matched=${matchedNames.length}`);
    }
  });

  for (const outcome of selection.outcomes) {
    const { matcher, matchedNames } = outcome;

    if (requiredOutcomes.includes(outcome) && matchedNames.length === 0) {
      core.error(
        `Required matcher ${quoteForLog(matcher.raw)} did not match any check run. ` +
          'It has not started, or it has not been created yet.',
      );
      continue;
    }

    core.notice(
      matchedNames.length === 0
        ? `Matcher ${quoteForLog(matcher.raw)} did not match any check run. This is treated as not started.`
        : `Matcher ${quoteForLog(matcher.raw)} matched ${matchedNames.length} check name(s).`,
    );
  }

  if (selection.selected.length === 0) {
    core.notice('No checks were selected by the provided matchers.');
    return;
  }

  group(`Selected Checks (${selection.selected.length})`, () => {
    for (const [index, checkRun] of selection.selected.entries()) {
      core.info(`${index + 1}. ${quoteForLog(checkRun.name)}`);
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
      core.info(
        `Check ${quoteForLog(checkRun.name)} => status=${checkRun.status} conclusion=${checkRun.conclusion ?? 'null'}`,
      );

      // A failure is annotated with its details URL, so the log points straight at the run to open.
      if (outcome === 'failed') {
        core.error(checkRun.detailsUrl === null ? reason : `${reason} ${checkRun.detailsUrl}`);
      } else {
        core.notice(reason);
      }
    }
  });
}

function logSummary(
  summary: VerificationSummary,
  matchedCount: number,
  missingCount: number,
  errorOnFailure: boolean,
): void {
  group('Final Summary', () => {
    core.info(`Matched checks: ${matchedCount}`);
    core.info(`Successful checks: ${summary.succeededCount}`);
    core.info(`Skipped checks: ${summary.skippedCount}`);
    core.info(`Failed checks: ${summary.failedCount}`);
    core.info(`Required checks without a run: ${missingCount}`);
    core.info(`Error on failure: ${String(errorOnFailure)}`);
  });
}

/**
 * Reads the action inputs, verifies every check the matchers select and publishes the counts.
 *
 * The contract is "checks that started must have succeeded": a matcher in `checks` selecting nothing
 * is a check that never started, which is tolerated, while a selected check that is unfinished or
 * unsuccessful is a failure. A matcher in `required` selecting nothing is a failure too. `error_on_failure=false` downgrades that failure to a warning, leaving the counts for the
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
    const requiredInput = getInput(ActionInput.required);
    const errorOnFailure = getBooleanInput(ActionInput.error_on_failure);

    if (ref === '') {
      throw new Error("No ref to inspect. Provide a git reference in 'ref'.");
    }

    const matchers: Matcher[] = normalizeMatchers(checks).map((raw) => resolveMatcher(raw, matchMode));
    const requiredMatchers: Matcher[] =
      requiredInput === '' ? [] : normalizeMatchers(requiredInput).map((raw) => resolveMatcher(raw, matchMode));

    group('Configuration', () => {
      core.info(`Repository: ${repository.owner}/${repository.repo}`);
      core.info(`Ref: ${quoteForLog(ref)}`);
      core.info(`Match mode: ${matchMode}`);
      core.info(`Error on failure: ${String(errorOnFailure)}`);
      core.info(`Matchers: ${quoteAllForLog(matchers.map((matcher) => matcher.raw))}`);
      core.info(`Required matchers: ${quoteAllForLog(requiredMatchers.map((matcher) => matcher.raw))}`);
    });

    const collection = await collectCheckRuns(api ?? createCheckRunsApi(token), {
      ref,
      repository,
      runId: currentRunId(),
    });
    const checkRuns = latestCheckRuns(collection.checkRuns);

    logSnapshot(collection, checkRuns);

    if (checkRuns.length === 0) {
      core.notice(
        `No checks were available for matching in ${repository.owner}/${repository.repo} at ref ${quoteForLog(ref)}.`,
      );
    }

    // One evaluation for both lists, so the pattern budget is spent once and a run selected by both is
    // verified once. The required outcomes are the trailing ones.
    const selection = selectChecks(checkRuns, [...matchers, ...requiredMatchers]);
    const requiredOutcomes = selection.outcomes.slice(matchers.length);
    const missing = missingRequired(requiredOutcomes);
    logSelection(selection, requiredOutcomes);

    const summary = verifyCheckRuns(selection.selected);
    logVerification(summary);
    logSummary(summary, selection.selected.length, missing.length, errorOnFailure);

    const failedCount = summary.failedCount + missing.length;

    setOutput(ActionOutput.matched_checks_count, String(selection.selected.length));
    setOutput(ActionOutput.failed_checks_count, String(failedCount));

    if (failedCount === 0) {
      return;
    }

    const failure = `Verification failed because ${failedCount} check(s) did not pass`;

    if (errorOnFailure) {
      core.setFailed(`${failure} and error_on_failure=true.`);
      return;
    }

    core.warning(`Found ${failedCount} failing check(s), but continuing because error_on_failure=false.`);
  });
}
