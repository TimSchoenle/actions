/**
 * Counts the findings in zizmor's SARIF and decides whether they fail the job.
 *
 * zizmor in SARIF mode exits 0 whatever it finds, so without this a job that runs it gates nothing.
 * The SARIF is read, never trusted to be well formed: a file this cannot read fails the step, because
 * reading it as zero findings would turn a broken run into a green one.
 */
import { quoteForLog } from 'actions-util';

import { SarifFormatError } from './errors.js';
import { SEVERITIES } from './options.js';

import type { FailThreshold, Severity } from './options.js';

/** The SARIF result property zizmor records its severity under. */
export const SEVERITY_PROPERTY = 'zizmor/severity';

/** One result, reduced to what the gate and the summary need. */
export interface Finding {
  readonly rule: string;
  readonly file: string;
  /** Undefined when the result has no region, such as a finding about a whole file. */
  readonly line: number | undefined;
  /** The severity as zizmor wrote it, lower-cased; undefined when it wrote none. */
  readonly severity: string | undefined;
  readonly message: string;
}

/** Placeholder for a rule, file or message the SARIF does not give. */
const UNKNOWN = '(unknown)';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value at a path of object keys, or undefined where the path leaves the objects. */
function valueAt(value: unknown, ...keys: string[]): unknown {
  let current = value;

  for (const key of keys) {
    current = isRecord(current) ? current[key] : undefined;
  }

  return current;
}

function stringAt(value: unknown, ...keys: string[]): string | undefined {
  const found = valueAt(value, ...keys);

  return typeof found === 'string' ? found : undefined;
}

function toFinding(result: unknown, index: number): Finding {
  if (!isRecord(result)) {
    throw new SarifFormatError(`result ${index} is not an object.`);
  }

  const locations = result['locations'];
  const physical = valueAt(Array.isArray(locations) ? locations[0] : undefined, 'physicalLocation');
  const line = valueAt(physical, 'region', 'startLine');

  return {
    rule: stringAt(result, 'ruleId') ?? UNKNOWN,
    file: stringAt(physical, 'artifactLocation', 'uri') ?? UNKNOWN,
    line: typeof line === 'number' && Number.isSafeInteger(line) && line > 0 ? line : undefined,
    severity: stringAt(result, 'properties', SEVERITY_PROPERTY)?.toLowerCase(),
    message: stringAt(result, 'message', 'text') ?? UNKNOWN,
  };
}

/**
 * Reads every result of a SARIF 2.1.0 log.
 *
 * zizmor writes one run with a `results` array, empty when it found nothing. A log with no run, or a
 * run without `results`, means something other than zizmor wrote the file or zizmor stopped part
 * way, and is refused instead of being read as clean.
 *
 * @throws {@link SarifFormatError} for anything that is not such a log.
 */
export function parseSarif(text: string): Finding[] {
  let document: unknown;

  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new SarifFormatError('the SARIF file is not JSON.', { cause: error });
  }

  if (!isRecord(document) || document['version'] !== '2.1.0') {
    throw new SarifFormatError('the SARIF file is not a SARIF 2.1.0 log.');
  }

  const runs = document['runs'];

  if (!Array.isArray(runs) || runs.length === 0) {
    throw new SarifFormatError('the SARIF file holds no run.');
  }

  const findings: Finding[] = [];

  for (const [runIndex, run] of runs.entries()) {
    const results = isRecord(run) ? run['results'] : undefined;

    if (!Array.isArray(results)) {
      throw new SarifFormatError(`run ${runIndex} of the SARIF file has no results array.`);
    }

    for (const result of results) {
      findings.push(toFinding(result, findings.length));
    }
  }

  return findings;
}

/** The rank of a severity zizmor writes, or undefined for one it does not. */
export function severityRank(severity: string | undefined): number | undefined {
  const rank = (SEVERITIES as readonly string[]).indexOf(severity ?? '');

  return rank === -1 ? undefined : rank;
}

/**
 * Whether a finding fails the gate.
 *
 * A severity this action does not know fails at every threshold but `none`. A zizmor release that
 * renames the property or adds a level must not make every finding pass silently.
 */
export function isFailing(finding: Finding, threshold: FailThreshold): boolean {
  if (threshold === 'none') {
    return false;
  }

  const rank = severityRank(finding.severity);

  return rank === undefined || rank >= SEVERITIES.indexOf(threshold);
}

/** Orders findings for the summary: failing first, then by severity, file and line. */
export function compareFindings(threshold: FailThreshold): (left: Finding, right: Finding) => number {
  const order = (finding: Finding): number => severityRank(finding.severity) ?? SEVERITIES.length;

  return (left, right) =>
    Number(isFailing(right, threshold)) - Number(isFailing(left, threshold)) ||
    order(right) - order(left) ||
    left.file.localeCompare(right.file) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.rule.localeCompare(right.rule);
}

/** The severity as the summary and the log show it. */
export function severityLabel(finding: Finding): Severity | string {
  return finding.severity ?? 'no severity';
}

/** Escapes text for an HTML table cell. The job summary renders HTML, and a file name is untrusted. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A finding as one log line, every untrusted part quoted. */
export function describeFinding(finding: Finding): string {
  const location =
    finding.line === undefined ? quoteForLog(finding.file) : `${quoteForLog(finding.file)} line ${finding.line}`;

  return `${severityLabel(finding)}: ${quoteForLog(finding.rule)} in ${location}: ${quoteForLog(finding.message)}`;
}
