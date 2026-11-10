/**
 * The runner interface every action uses: inputs, outputs, the step log, annotations, masking, the
 * job summary and the exit code. Imported as `actions-util/core`.
 *
 * A dependency-free replacement for the part of `@actions/core` this repository uses, with the same
 * names, signatures and output byte for byte. `@actions/core` pulls in `@actions/http-client`, and
 * with it undici, for its OIDC client alone; that was over 400 KB of every committed bundle, for a
 * feature no action here calls. Anything beyond this surface — `getIDToken`, `exportVariable`,
 * `saveState` — is deliberately absent: add it, with tests, when an action needs it.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { EOL } from 'node:os';
import path from 'node:path';

import { formatCommand, prepareKeyValueMessage, toCommandProperties, toCommandValue } from './workflow-commands.js';

import type { AnnotationProperties, CommandProperties } from './workflow-commands.js';

export { summary } from './summary.js';
export type { AnnotationProperties } from './workflow-commands.js';
export type { Summary, SummaryTableCell, SummaryWriteOptions } from './summary.js';

/** Options for reading an input. */
export interface InputOptions {
  /** Throw when the input is empty or unset. */
  required?: boolean;
  /** Trim surrounding whitespace from the value (and from each line of a multiline input). Default `true`. */
  trimWhitespace?: boolean;
}

/** The process exit codes {@link setFailed} uses. */
export const ExitCode = {
  Success: 0,
  Failure: 1,
} as const;

/** Writes one workflow command to stdout, where the runner parses it. */
function issueCommand(command: string, properties: CommandProperties, message: unknown): void {
  process.stdout.write(formatCommand(command, properties, message) + EOL);
}

/** The file a file command writes to, which must exist: the runner creates it before the step starts. */
function issueFileCommand(command: 'OUTPUT' | 'PATH', message: string): void {
  const filePath = process.env[`GITHUB_${command}`];

  if (!filePath) {
    throw new Error(`Unable to find environment variable for file command ${command}`);
  }

  if (!existsSync(filePath)) {
    throw new Error(`Missing file at path: ${filePath}`);
  }

  appendFileSync(filePath, `${message}${EOL}`, { encoding: 'utf8' });
}

/**
 * Reads an input from the environment the runner sets: `INPUT_` and the name with spaces replaced by
 * `_`, upper-cased. Trimmed unless `trimWhitespace` is `false`.
 *
 * @throws when the input is `required` and empty.
 */
export function getInput(name: string, options?: InputOptions): string {
  const value = process.env[`INPUT_${name.replaceAll(' ', '_').toUpperCase()}`] || '';

  if (options?.required && !value) {
    throw new Error(`Input required and not supplied: ${name}`);
  }

  return options?.trimWhitespace === false ? value : value.trim();
}

/** Reads an input as its non-empty lines, each trimmed unless `trimWhitespace` is `false`. */
export function getMultilineInput(name: string, options?: InputOptions): string[] {
  const lines = getInput(name, options)
    .split('\n')
    .filter((line) => line !== '');

  return options?.trimWhitespace === false ? lines : lines.map((line) => line.trim());
}

const TRUE_VALUES: readonly string[] = ['true', 'True', 'TRUE'];
const FALSE_VALUES: readonly string[] = ['false', 'False', 'FALSE'];

/**
 * Reads an input as a YAML 1.2 core-schema boolean: `true`, `True`, `TRUE`, `false`, `False` or
 * `FALSE`.
 *
 * @throws a `TypeError` for any other value, an empty one included.
 */
export function getBooleanInput(name: string, options?: InputOptions): boolean {
  const value = getInput(name, options);

  if (TRUE_VALUES.includes(value)) {
    return true;
  }

  if (FALSE_VALUES.includes(value)) {
    return false;
  }

  throw new TypeError(
    `Input does not meet YAML 1.2 "Core Schema" specification: ${name}\n` +
      'Support boolean input list: `true | True | TRUE | false | False | FALSE`',
  );
}

/**
 * Sets a step output: a heredoc entry in `GITHUB_OUTPUT`, or the deprecated `set-output` command
 * when the runner names no output file.
 */
export function setOutput(name: string, value: unknown): void {
  if (process.env.GITHUB_OUTPUT) {
    issueFileCommand('OUTPUT', prepareKeyValueMessage(name, value));

    return;
  }

  process.stdout.write(EOL);
  issueCommand('set-output', { name }, toCommandValue(value));
}

/** Masks `secret` in every later line of the log. */
export function setSecret(secret: string): void {
  issueCommand('add-mask', {}, secret);
}

/** Prepends `inputPath` to `PATH`, for this step and every later one. */
export function addPath(inputPath: string): void {
  if (process.env.GITHUB_PATH) {
    issueFileCommand('PATH', inputPath);
  } else {
    issueCommand('add-path', {}, inputPath);
  }

  process.env.PATH = `${inputPath}${path.delimiter}${process.env.PATH}`;
}

/** Writes a line to the log. Not escaped: see `quoteForLog` for untrusted values. */
export function info(message: string): void {
  process.stdout.write(message + EOL);
}

/** Writes a debug line, which the runner shows only when step debugging is on. */
export function debug(message: string): void {
  issueCommand('debug', {}, message);
}

/** Renders the message of an annotation; an `Error` is rendered as `Name: message`. */
function annotationMessage(message: string | Error): string {
  return message instanceof Error ? message.toString() : message;
}

/** Writes an error annotation. */
export function error(message: string | Error, properties: AnnotationProperties = {}): void {
  issueCommand('error', toCommandProperties(properties), annotationMessage(message));
}

/** Writes a warning annotation. */
export function warning(message: string | Error, properties: AnnotationProperties = {}): void {
  issueCommand('warning', toCommandProperties(properties), annotationMessage(message));
}

/** Writes a notice annotation. */
export function notice(message: string | Error, properties: AnnotationProperties = {}): void {
  issueCommand('notice', toCommandProperties(properties), annotationMessage(message));
}

/** Fails the step: sets the exit code to 1 and writes `message` as an error annotation. */
export function setFailed(message: string | Error): void {
  process.exitCode = ExitCode.Failure;
  error(message);
}

/** Opens a collapsible group in the log, closed by {@link endGroup}. */
export function startGroup(name: string): void {
  issueCommand('group', {}, name);
}

/** Closes the group {@link startGroup} opened. */
export function endGroup(): void {
  issueCommand('endgroup', {}, '');
}
