import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveInputEnv } from './action-inputs.js';
import { loadActionManifest } from './action-manifest.js';
import { parseFileCommands } from './github-file-commands.js';
import { resolveRuntime } from './runtime.js';
import { parseWorkflowCommands, redact } from './workflow-commands.js';

import type { ProvidedInputs } from './action-inputs.js';
import type { ActionManifest } from './action-manifest.js';
import type { ActionRuntime } from './runtime.js';
import type { WorkflowCommands } from './workflow-commands.js';

/** Which build of the action to execute. */
export type ActionEntry = 'dist' | 'source';

/** What the case expects of the action's exit status. */
export type ExpectedOutcome = 'success' | 'failure' | 'any';

/** Default ceiling on a single action run, generous enough for a slow API call but not a hang. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** How many trailing log lines a failure report quotes before it stops being readable. */
const REPORT_LOG_LINES = 40;

/**
 * Parent environment variables a spawned action may inherit.
 *
 * An allowlist rather than `...process.env`: inheriting the developer's shell would let a run pass
 * locally on an ambient `GITHUB_TOKEN` and fail in CI, which is precisely the class of flake this
 * harness exists to remove. Everything an action legitimately needs is passed explicitly.
 */
const INHERITED_ENV = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'SYSTEMROOT',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'NODE_EXTRA_CA_CERTS',
  'ACTIONS_STEP_DEBUG',
]);

/** Set when the caller wants the scratch workspace left behind for inspection. */
const KEEP_WORKSPACE_ENV = 'E2E_KEEP_WORKSPACE';

export interface RunActionOptions<TInput extends string> {
  /** Directory holding the `action.yaml` of the action under test. */
  actionDirectory: string;
  inputs?: ProvidedInputs<TInput>;
  /**
   * `dist` runs the committed bundle GitHub itself would run, and is the default because it is the
   * artifact that ships. `source` runs `src/generated/index.ts` under bun, for a fast edit loop.
   */
  entry?: ActionEntry;
  expect?: ExpectedOutcome;
  /** Extra environment, typically the `GITHUB_*` context an action reads. Overrides the defaults. */
  env?: Readonly<Record<string, string>>;
  /** Values to redact from any failure report, on top of whatever the action masks itself. */
  secrets?: readonly string[];
  timeoutMs?: number;
}

export interface ActionRunResult<TOutput extends string> extends WorkflowCommands {
  exitCode: number;
  /** Everything written to `GITHUB_OUTPUT`; absent keys were never set. */
  outputs: Partial<Record<TOutput, string>>;
  /** Everything written to `GITHUB_ENV`, which a later step would see as environment. */
  exportedEnv: Record<string, string>;
  /** Everything written to `GITHUB_STATE`, which the action's own post step would read back. */
  state: Record<string, string>;
  stdout: string;
  stderr: string;
  /** The scratch directory used as `GITHUB_WORKSPACE`; removed unless `E2E_KEEP_WORKSPACE` is set. */
  workspace: string;
}

/** Raised when a run's exit status is not the one the case declared. */
export class ActionOutcomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionOutcomeError';
  }
}

function lastLines(text: string, count: number): string {
  const lines = text.split(/\r?\n/).filter((line) => line !== '');

  return lines.slice(-count).join('\n');
}

function section(title: string, body: string): string {
  return body === '' ? '' : `\n${title}:\n${body.replace(/^/gm, '  ')}`;
}

function describeRun(manifest: ActionManifest, result: ActionRunResult<string>, expected: ExpectedOutcome): string {
  const masks = [...result.masks];

  return (
    `Action '${manifest.name}' (${manifest.directory}) exited with ${result.exitCode}, expected ${expected}.` +
    section('annotated errors', redact(result.errors.join('\n'), masks)) +
    section('stderr', redact(lastLines(result.stderr, REPORT_LOG_LINES), masks)) +
    section('stdout (tail)', redact(lastLines(result.stdout, REPORT_LOG_LINES), masks))
  );
}

function outcomeMatches(exitCode: number, expected: ExpectedOutcome): boolean {
  switch (expected) {
    case 'success': {
      return exitCode === 0;
    }
    case 'failure': {
      return exitCode !== 0;
    }
    case 'any': {
      return true;
    }
  }
}

function entryPoint(manifest: ActionManifest, entry: ActionEntry): { script: string; runtime: ActionRuntime } {
  return entry === 'dist'
    ? { script: path.join(manifest.directory, manifest.main), runtime: 'node' }
    : { script: path.join(manifest.directory, 'src', 'generated', 'index.ts'), runtime: 'bun' };
}

/** `RUNNER_OS` as the runner reports it, which some actions branch on. */
function runnerOs(): string {
  switch (process.platform) {
    case 'win32': {
      return 'Windows';
    }
    case 'darwin': {
      return 'macOS';
    }
    default: {
      return 'Linux';
    }
  }
}

function inheritedEnv(): Record<string, string> {
  const inherited: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && INHERITED_ENV.has(key.toUpperCase())) {
      inherited[key] = value;
    }
  }

  return inherited;
}

/** The command files the runner creates for a step, and which `@actions/core` appends to. */
const COMMAND_FILES = ['GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_STATE', 'GITHUB_PATH', 'GITHUB_STEP_SUMMARY'] as const;

async function prepareCommandFiles(directory: string): Promise<Record<string, string>> {
  const paths: Record<string, string> = {};

  for (const variable of COMMAND_FILES) {
    const file = path.join(directory, `${variable.toLowerCase()}.txt`);

    // `@actions/core` throws rather than creating the file, exactly as the runner would.
    await writeFile(file, '', 'utf8');
    paths[variable] = file;
  }

  return paths;
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function spawnAction(
  executable: string,
  script: string,
  env: Record<string, string>,
  cwd: string,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [script], { cwd, env, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ActionOutcomeError(`Action did not finish within ${timeoutMs}ms and was killed.`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        // A killed process reports a null code; treating that as success would pass a crashed action.
        exitCode: code ?? (signal === null ? 1 : 128),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

/**
 * Runs a node20 action the way the GitHub runner does, and returns everything it published.
 *
 * The point of driving the action as a subprocess rather than importing its `run()` is fidelity:
 * this exercises the shipped bundle, the `INPUT_*` decoding, the `action.yaml` defaults and the
 * `GITHUB_OUTPUT` encoding — all the seams a unit test mocks away and a workflow tests by accident.
 */
export async function runAction<TInput extends string, TOutput extends string>(
  options: RunActionOptions<TInput>,
): Promise<ActionRunResult<TOutput>> {
  const manifest = await loadActionManifest(options.actionDirectory);
  const { script, runtime } = entryPoint(manifest, options.entry ?? 'dist');
  const executable = resolveRuntime(runtime);

  const scratch = await mkdtemp(path.join(tmpdir(), 'actions-e2e-'));
  const workspace = path.join(scratch, 'workspace');
  const expected = options.expect ?? 'success';

  try {
    await mkdir(workspace, { recursive: true });
    const commandFiles = await prepareCommandFiles(scratch);

    const env: Record<string, string> = {
      ...inheritedEnv(),
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTION: '__run',
      GITHUB_API_URL: 'https://api.github.com',
      GITHUB_GRAPHQL_URL: 'https://api.github.com/graphql',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_WORKSPACE: workspace,
      RUNNER_OS: runnerOs(),
      RUNNER_TEMP: scratch,
      ...commandFiles,
      ...options.env,
      ...resolveInputEnv(manifest, options.inputs),
    };

    // The runner starts a step in `GITHUB_WORKSPACE`, so the harness must too: an action that
    // resolves a path against `process.cwd()` would otherwise read a directory GitHub never uses.
    const spawned = await spawnAction(executable, script, env, workspace, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const commands = parseWorkflowCommands(spawned.stdout);

    const result: ActionRunResult<TOutput> = {
      ...commands,
      masks: [...commands.masks, ...(options.secrets ?? [])],
      exitCode: spawned.exitCode,
      outputs: parseFileCommands(await readFile(commandFiles['GITHUB_OUTPUT'], 'utf8')) as Partial<
        Record<TOutput, string>
      >,
      exportedEnv: parseFileCommands(await readFile(commandFiles['GITHUB_ENV'], 'utf8')),
      state: parseFileCommands(await readFile(commandFiles['GITHUB_STATE'], 'utf8')),
      stdout: spawned.stdout,
      stderr: spawned.stderr,
      workspace,
    };

    if (!outcomeMatches(result.exitCode, expected)) {
      throw new ActionOutcomeError(describeRun(manifest, result, expected));
    }

    return result;
  } finally {
    if (process.env[KEEP_WORKSPACE_ENV] === undefined) {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
