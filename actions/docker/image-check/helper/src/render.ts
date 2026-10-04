/**
 * Everything this action writes for a human: the pull request comment, the step summary row and the
 * fragment `image-check-summary` turns into a table row.
 *
 * Pure functions of the measured facts, so each rendering is pinned by a snapshot. Every value that
 * reaches Markdown here — the image reference, the platform, the severity list — has already been
 * validated against a grammar with no backtick, pipe or newline in it, which is what makes inlining
 * it in a code span or a table cell safe without escaping.
 */
import { formatMib, isAbove } from './gates.js';

/** The measured and scanned facts about one image. */
export interface ImageResult {
  readonly image: string;
  /** Empty when the caller named no platform. */
  readonly platform: string;
  readonly sizeBytes: number;
  /** 0 when disabled. */
  readonly warningMib: number;
  /** 0 when disabled. */
  readonly limitMib: number;
  readonly severity: string;
  readonly findings: number;
}

/** Schema version of {@link ImageFragment}, bumped whenever a field changes meaning. */
export const FRAGMENT_VERSION = 1;

/** What one leg hands `image-check-summary`, as one JSON object in one artifact. */
export interface ImageFragment {
  readonly version: typeof FRAGMENT_VERSION;
  readonly platform: string;
  readonly image: string;
  readonly size_bytes: number;
  readonly warning_mib: number;
  readonly findings: number;
  readonly severity: string;
}

/** The name a row or a comment calls the image by: the platform when there is one. */
function label(result: ImageResult): string {
  return result.platform === '' ? result.image : result.platform;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** How the size relates to each enabled threshold, as a clause appended to the size. */
function thresholdClause(result: ImageResult): string {
  const clauses: string[] = [];

  if (result.warningMib > 0) {
    clauses.push(
      isAbove(result.sizeBytes, result.warningMib)
        ? `above the ${result.warningMib} MiB warning`
        : `warning above ${result.warningMib} MiB`,
    );
  }

  if (result.limitMib > 0) {
    clauses.push(
      isAbove(result.sizeBytes, result.limitMib)
        ? `above the ${result.limitMib} MiB limit`
        : `limit ${result.limitMib} MiB`,
    );
  }

  return clauses.length === 0 ? '' : `, ${clauses.join(', ')}`;
}

function findingsSentence(result: ImageResult): string {
  const count = result.findings === 0 ? 'no findings' : plural(result.findings, 'finding');

  return `${count} at ${result.severity}`;
}

/**
 * Renders the per-image pull request comment.
 *
 * @param codeScanningUrl - link to the pull request's code scanning alerts, omitted when the SARIF
 * was not uploaded and there is nothing to link to.
 */
export function renderComment(result: ImageResult, codeScanningUrl: string | undefined): string {
  const link = codeScanningUrl === undefined ? '' : ` [Code scanning](${codeScanningUrl})`;

  return [
    `**Docker image** \`${label(result)}\`: ${formatMib(result.sizeBytes)} MiB (uncompressed)${thresholdClause(result)}.`,
    `Trivy: ${findingsSentence(result)}.${link}`,
  ].join('\n');
}

/** The size cell of a table row: the size, and the threshold it crossed when it crossed one. */
export function sizeCell(sizeBytes: number, warningMib: number, limitMib = 0): string {
  const size = formatMib(sizeBytes);

  if (isAbove(sizeBytes, limitMib)) {
    return `${size} (above the ${limitMib} limit)`;
  }

  return isAbove(sizeBytes, warningMib) ? `${size} (above ${warningMib})` : size;
}

/**
 * Renders the step summary for one image: a one-row table, written on every event.
 *
 * Written on push and on fork pull requests too, where nothing else is published — it is the one
 * place the result is always visible.
 */
export function renderStepSummary(result: ImageResult): string {
  const platform = result.platform === '' ? '—' : `\`${result.platform}\``;

  return [
    '**Docker image check**',
    '',
    '| Image | Platform | Size (MiB, uncompressed) | Trivy findings |',
    '| --- | --- | --- | --- |',
    `| \`${result.image}\` | ${platform} | ${sizeCell(result.sizeBytes, result.warningMib, result.limitMib)} | ${result.findings} at ${result.severity} |`,
    '',
  ].join('\n');
}

/** The fragment one leg uploads for `image-check-summary`. */
export function toFragment(result: ImageResult): ImageFragment {
  return {
    version: FRAGMENT_VERSION,
    platform: result.platform,
    image: result.image,
    size_bytes: result.sizeBytes,
    warning_mib: result.warningMib,
    findings: result.findings,
    severity: result.severity,
  };
}
