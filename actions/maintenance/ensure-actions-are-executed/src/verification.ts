import type { CheckRun } from './checks.js';

/** The verdict for a single check. */
export type CheckOutcome = 'failed' | 'skipped' | 'success';

export interface CheckVerification {
  checkRun: CheckRun;
  outcome: CheckOutcome;
  /** Human-readable justification, used verbatim in the log line for this check. */
  reason: string;
}

export interface VerificationSummary {
  verifications: CheckVerification[];
  /** Number of checks that completed successfully. */
  succeededCount: number;
  /** Number of checks GitHub reported as skipped; ignored rather than failed. */
  skippedCount: number;
  /** Number of checks that started but did not end in success. */
  failedCount: number;
}

/**
 * Verifies a single check that started.
 *
 * A skipped check is ignored: `if:` conditions and path filters skip checks by design, and the caller
 * asked for "started checks must succeed", not "every check must run".
 *
 * A check that started but has not completed counts as failed. This action runs after the checks it
 * verifies, so an incomplete check is a check that hung, was cancelled, or is waiting on something
 * that will never arrive — none of which may pass as success.
 */
export function verifyCheckRun(checkRun: CheckRun): CheckVerification {
  const completed = checkRun.status === 'completed';

  if (completed && checkRun.conclusion === 'skipped') {
    return { checkRun, outcome: 'skipped', reason: `Check '${checkRun.name}' was skipped and is ignored.` };
  }

  if (!completed) {
    return {
      checkRun,
      outcome: 'failed',
      reason: `Check '${checkRun.name}' started but is not completed (status=${checkRun.status}).`,
    };
  }

  if (checkRun.conclusion !== 'success') {
    return {
      checkRun,
      outcome: 'failed',
      reason: `Check '${checkRun.name}' started but did not succeed (conclusion=${checkRun.conclusion ?? 'null'}).`,
    };
  }

  return { checkRun, outcome: 'success', reason: `Check '${checkRun.name}' completed successfully.` };
}

/** Verifies every selected check and counts the outcomes. */
export function verifyCheckRuns(checkRuns: CheckRun[]): VerificationSummary {
  const verifications = checkRuns.map((checkRun) => verifyCheckRun(checkRun));
  const count = (outcome: CheckOutcome): number =>
    verifications.filter((verification) => verification.outcome === outcome).length;

  return {
    failedCount: count('failed'),
    skippedCount: count('skipped'),
    succeededCount: count('success'),
    verifications,
  };
}
