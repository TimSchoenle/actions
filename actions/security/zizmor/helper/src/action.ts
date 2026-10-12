import { mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import * as core from '@actions/core';
import { quoteAllForLog, quoteForLog, runAction, workspaceRoot } from 'actions-util';

import { findByteOrderMarks } from './bom.js';
import { describeExit, runContainer } from './container.js';
import { ByteOrderMarkError, FindingsError, InvalidInputError, ZizmorRunError } from './errors.js';
import { compareFindings, describeFinding, escapeHtml, isFailing, parseSarif, severityLabel } from './gate.js';
import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { resolveAuditInputs, resolveConfigPath } from './input-paths.js';
import { FAIL_THRESHOLDS, parseChoice, resolveScanOptions, zizmorArguments } from './options.js';

import type { Finding } from './gate.js';
import type { RawScanInputs } from './options.js';

/**
 * The bundle `security/zizmor` runs twice: once as `scan` before the SARIF upload, once as `gate` after it.
 *
 * `scan` validates every input, annotates every input file that starts with a byte order mark, then
 * runs zizmor in its container and checks that what it wrote is SARIF. `gate` counts the findings in
 * that SARIF and fails the step on those at or above `fail-on-severity`. The upload sits between the
 * two so findings reach code scanning whether or not they fail the job.
 */

/** Findings listed in the job summary and the log; the rest are counted. */
const MAX_LISTED_FINDINGS = 100;

function readScanInputs(): RawScanInputs {
  return {
    inputs: getInput(ActionInput.inputs),
    persona: getInput(ActionInput.persona),
    onlineAudits: getInput(ActionInput.online_audits),
    minSeverity: getInput(ActionInput.min_severity),
    minConfidence: getInput(ActionInput.min_confidence),
    config: getInput(ActionInput.config),
    failOnSeverity: getInput(ActionInput.fail_on_severity),
    strictCollection: getInput(ActionInput.strict_collection),
    upload: getInput(ActionInput.upload),
    token: getInput(ActionInput.token),
    image: getInput(ActionInput.image),
  };
}

function runnerTemp(): string {
  const temp = process.env['RUNNER_TEMP'];

  if (temp === undefined || temp === '') {
    throw new ZizmorRunError('RUNNER_TEMP is not set. This action runs only on a GitHub Actions runner.');
  }

  return temp;
}

/**
 * Replaces every occurrence of a secret in an error's message and stack, the two fields the failure
 * path prints.
 *
 * The runner masks a registered secret in what it renders, but a message that quotes a rejected
 * input would otherwise hand the token to anything that reads the raw log: the step's own debug
 * output, a log forwarder, a test harness. Not relying on the mask is cheaper than reasoning about
 * every reader.
 */
function redactSecret(error: unknown, secret: string): unknown {
  if (secret === '' || !(error instanceof Error)) {
    return error;
  }

  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    current.message = current.message.replaceAll(secret, '***');

    if (current.stack !== undefined) {
      current.stack = current.stack.replaceAll(secret, '***');
    }
  }

  return error;
}

/** Validates, scans for byte order marks, runs zizmor and publishes where its SARIF is. */
async function scan(): Promise<void> {
  const token = getInput(ActionInput.token);

  // Masked before anything is validated, so no message about any input can carry it into the log.
  if (token !== '') {
    core.setSecret(token);
  }

  try {
    await scanWith();
  } catch (error) {
    throw redactSecret(error, token);
  }
}

async function scanWith(): Promise<void> {
  const options = resolveScanOptions(readScanInputs());
  const workspace = resolve(workspaceRoot());
  const inputs = await resolveAuditInputs(options.inputs, workspace);
  const config = options.config === undefined ? undefined : await resolveConfigPath(options.config, workspace);
  const paths = inputs.map((input) => input.argument);

  core.info(`Auditing ${quoteAllForLog(paths)} as ${options.persona}.`);

  const marked = await findByteOrderMarks(inputs, workspace);

  for (const file of marked) {
    const message = 'starts with a UTF-8 byte order mark, which zizmor cannot parse. Save it without the BOM.';

    if (options.strictCollection) {
      core.error(message, { file, startLine: 1, title: 'Byte order mark' });
    } else {
      core.warning(`${message} zizmor skips it while strict-collection is off.`, {
        file,
        startLine: 1,
        title: 'Byte order mark',
      });
    }
  }

  if (marked.length > 0 && options.strictCollection) {
    throw new ByteOrderMarkError(marked);
  }

  const sarifFile = join(await mkdtemp(join(runnerTemp(), 'zizmor-')), 'results.sarif');
  const run = {
    image: options.image,
    workspace,
    zizmorArguments: zizmorArguments(options, paths, config),
    online: options.onlineAudits,
  };

  core.info(`Running ${quoteForLog(options.image)}. zizmor's log follows, each line prefixed with "|".`);

  const { exitCode } = await runContainer(run, sarifFile, options.token, (line) => {
    process.stdout.write(`${line}\n`);
  });

  if (exitCode !== 0) {
    throw new ZizmorRunError(describeExit(exitCode));
  }

  const findings = parseSarif(await readFile(sarifFile, 'utf8'));

  core.info(`zizmor wrote ${findings.length} finding(s) to ${quoteForLog(sarifFile)}.`);
  setOutput(ActionOutput.sarif_file, sarifFile);
  setOutput(ActionOutput.upload, String(options.upload));
}

/** One summary table row per finding. Every cell is escaped: the SARIF repeats names from the repository. */
function summaryRows(findings: readonly Finding[]): string[][] {
  return findings.map((finding) => [
    escapeHtml(severityLabel(finding)),
    `<code>${escapeHtml(finding.rule)}</code>`,
    `<code>${escapeHtml(finding.file)}</code>`,
    finding.line === undefined ? '' : String(finding.line),
    escapeHtml(finding.message),
  ]);
}

/** Writes the findings table to the job summary. */
async function writeSummary(findings: readonly Finding[], failing: number, threshold: string): Promise<void> {
  const listed = findings.slice(0, MAX_LISTED_FINDINGS);

  core.summary
    .addHeading('zizmor', 2)
    .addRaw(`${findings.length} finding(s), ${failing} at or above <code>${escapeHtml(threshold)}</code>.`, true);

  if (listed.length > 0) {
    core.summary.addTable([
      [
        { data: 'Severity', header: true },
        { data: 'Rule', header: true },
        { data: 'File', header: true },
        { data: 'Line', header: true },
        { data: 'Message', header: true },
      ],
      ...summaryRows(listed),
    ]);
  }

  if (findings.length > listed.length) {
    core.summary.addRaw(`${findings.length - listed.length} more not listed. The SARIF file has every one.`, true);
  }

  await core.summary.write();
}

/** Counts the findings, publishes the counts and the summary, then fails on those at or above the threshold. */
async function gate(): Promise<void> {
  const threshold = parseChoice('fail-on-severity', getInput(ActionInput.fail_on_severity), FAIL_THRESHOLDS);
  const sarifFile = getInput(ActionInput.sarif_file);

  if (sarifFile.trim() === '') {
    throw new InvalidInputError('sarif_file', 'is empty. The scan step publishes it only when zizmor succeeded.');
  }

  let text: string;

  try {
    text = await readFile(sarifFile, 'utf8');
  } catch (error) {
    throw new ZizmorRunError(`the SARIF file ${quoteForLog(sarifFile)} cannot be read.`, { cause: error });
  }

  const findings = parseSarif(text).sort(compareFindings(threshold));
  const failing = findings.filter((finding) => isFailing(finding, threshold));

  setOutput(ActionOutput.findings, String(findings.length));
  setOutput(ActionOutput.failing, String(failing.length));

  for (const finding of failing.slice(0, MAX_LISTED_FINDINGS)) {
    core.info(describeFinding(finding));
  }

  if (failing.length > MAX_LISTED_FINDINGS) {
    core.info(`${failing.length - MAX_LISTED_FINDINGS} more failing finding(s) not listed.`);
  }

  await writeSummary(findings, failing.length, threshold);

  if (failing.length > 0) {
    throw new FindingsError(failing.length, threshold);
  }

  core.info(`${findings.length} finding(s), none at or above ${threshold}.`);
}

/** Dispatches on the mode the composite passes. */
export function run(): Promise<void> {
  return runAction(async () => {
    const mode = getInput(ActionInput.mode).trim();

    if (mode === 'scan') {
      await scan();
    } else if (mode === 'gate') {
      await gate();
    } else {
      throw new InvalidInputError('mode', `${quoteForLog(mode)} is not scan or gate.`);
    }
  });
}
