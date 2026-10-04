/**
 * Counting the results in the SARIF log Trivy wrote.
 *
 * The count is what `trivy-fail-on-findings` gates on, so a file that is not a SARIF log is an
 * error, never zero: a broken scan read as "no findings" would pass the very gate meant to stop it.
 */
import { SarifError } from './errors.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sums the results of every run in a parsed SARIF log.
 *
 * A run without a `results` array has no results — SARIF makes the property optional, and Trivy
 * omits it for a clean image. A log without a `runs` array is not SARIF at all.
 *
 * @throws {SarifError} when the value is not a SARIF log.
 */
export function countSarifResults(log: unknown): number {
  if (!isRecord(log) || !Array.isArray(log['runs'])) {
    throw new SarifError("The SARIF file has no 'runs' array, so it is not a SARIF log.");
  }

  let count = 0;

  for (const [index, run] of log['runs'].entries()) {
    if (!isRecord(run)) {
      throw new SarifError(`The SARIF file's run ${index} is not an object.`);
    }

    const results = run['results'];

    if (results === undefined) {
      continue;
    }

    if (!Array.isArray(results)) {
      throw new SarifError(`The SARIF file's run ${index} has a 'results' value that is not an array.`);
    }

    count += results.length;
  }

  return count;
}

/** Parses SARIF text and counts its results. */
export function countSarifText(text: string): number {
  let log: unknown;

  try {
    log = JSON.parse(text);
  } catch (error) {
    throw new SarifError('The SARIF file is not valid JSON.', error);
  }

  return countSarifResults(log);
}
