import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

import * as core from '@actions/core';
import { quoteAllForLog, quoteForLog, runAction, workspaceRoot } from 'actions-util';

import { runChecks } from './checks.js';
import { createCommandRunner } from './command.js';
import { createDockerInspector } from './docker.js';
import { ContractDriftError, InvalidInputError } from './errors.js';
import { createFileReader, isDirectory } from './file-reader.js';
import { getInput, setOutput } from './generated/action-io.js';
import { createCargoGenerator, renderAll } from './generator.js';
import { labelsAsJson, parseLabelLines } from './labels.js';
import { resolveOptions } from './options.js';

import type { CheckReport, FileReader, Finding } from './checks.js';
import type { CommandRunner } from './command.js';
import type { ContractOptions, RawInputs } from './options.js';

/**
 * The three things this action cannot do for itself, injected so its wiring stays testable.
 *
 * Deliberately the *ports*, not the modules built on them: the generator, the docker inspector and
 * the checks are all constructed here from these, so a test of `run` still exercises the argument
 * vectors, the parsing and the ordering rather than a stand-in for them.
 */
export interface ActionDependencies {
  readonly runCommand: CommandRunner;
  readonly readFile: FileReader;
  readonly isDirectory: (absolutePath: string) => Promise<boolean>;
}

/** The real ports, bound to a process and a filesystem. */
function defaultDependencies(): ActionDependencies {
  return { runCommand: createCommandRunner(), readFile: createFileReader(), isDirectory };
}

/** Reads every input in one place, so `resolveOptions` stays a pure function over strings. */
function readInputs(): RawInputs {
  return {
    source_directory: getInput('source_directory'),
    example: getInput('example'),
    bin: getInput('bin'),
    package: getInput('package'),
    features: getInput('features'),
    dockerfile: getInput('dockerfile'),
    contract: getInput('contract'),
    image: getInput('image'),
    contract_path: getInput('contract_path'),
    extra_args: getInput('extra_args'),
  };
}

/** Where the embedded contract is copied to. `RUNNER_TEMP` on a runner, the OS default elsewhere. */
function temporaryDirectory(): string {
  const runnerTemp = process.env['RUNNER_TEMP'];

  return runnerTemp === undefined || runnerTemp === '' ? tmpdir() : runnerTemp;
}

/**
 * Announces what is about to be compared, before any of it happens.
 *
 * The values are quoted rather than interpolated: `core.info` writes to stdout verbatim and the
 * runner reads every line of that for workflow commands, and a workflow is free to pass
 * `${{ github.event.inputs.example }}` into any of these.
 */
function announce(options: ContractOptions): void {
  const { kind, name } = options.target;
  const where = options.packageName === undefined ? name : `${name} in ${options.packageName}`;

  core.info(`Rendering the contract from the ${quoteForLog(where)} ${kind}...`);

  if (options.features.length > 0) {
    core.info(`Features: ${quoteForLog(options.features.join(','))}.`);
  }

  if (options.extraArgs.length > 0) {
    core.info(`Generator arguments: ${quoteAllForLog(options.extraArgs)}.`);
  }
}

/** Reports what ran, what did not, and every fault that was found. */
/** The annotation properties a finding carries, which is a file, a file and a line, or neither. */
function annotationFor(finding: Finding): core.AnnotationProperties {
  if (finding.file === undefined) {
    return {};
  }

  return finding.line === undefined ? { file: finding.file } : { file: finding.file, startLine: finding.line };
}

function report(result: CheckReport): void {
  for (const finding of result.findings) {
    core.error(finding.message, annotationFor(finding));
  }

  if (result.skipped.length > 0) {
    core.info(`Skipped, their input being empty: ${result.skipped.join(', ')}.`);
  }

  if (result.findings.length === 0) {
    core.info(`✅ ${result.ran.join(', ')} — every comparison matched.`);
  }
}

/**
 * Renders the contract once and holds everything that claims to describe it to that rendering.
 *
 * The order is the whole design. The generator runs first and its output is refused if it is empty,
 * because a rendering that came out blank would make every comparison below trivially true. The
 * labels are parsed next, before any check needs them, so a malformed rendering fails the step
 * rather than one of the four checks. Only then do the comparisons run — all of them, collecting
 * findings — and the step fails once, at the end, having said everything it has to say.
 */
export function run(dependencies: ActionDependencies = defaultDependencies()): Promise<void> {
  return runAction(async () => {
    const raw = readInputs();
    const options = resolveOptions(raw, workspaceRoot());

    // Asked here rather than left to the generator: `@actions/exec` reports a working directory it
    // cannot enter in terms of an absolute path, which names the runner's layout instead of the
    // input that was actually wrong.
    if (!(await dependencies.isDirectory(options.sourceDirectory))) {
      throw new InvalidInputError('source_directory', `'${raw.source_directory}' is not a directory in the workspace.`);
    }

    announce(options);

    const renderings = await renderAll(createCargoGenerator(options, dependencies.runCommand));
    const labels = parseLabelLines(renderings.labels);
    const result = await runChecks({
      options,
      renderings,
      labels,
      readFile: dependencies.readFile,
      inspector: createDockerInspector(dependencies.runCommand),
      tempDirectory: temporaryDirectory(),
    });

    setOutput('checks_run', result.ran.join(' '));
    setOutput('checks_skipped', result.skipped.join(' '));
    setOutput('contract_checksum', createHash('sha256').update(renderings.contract, 'utf8').digest('hex'));
    setOutput('labels', labelsAsJson(labels));

    report(result);

    if (result.findings.length > 0) {
      throw new ContractDriftError(result.findings.length);
    }
  });
}
