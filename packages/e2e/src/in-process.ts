/**
 * Runs an action's `run()` inside the test process with the environment the runner would give it,
 * for unit tests that exercise the action's entry point without spawning its bundle.
 *
 * Inputs reach the action as `INPUT_*` variables and outputs come back from a real `GITHUB_OUTPUT`
 * file, so the test observes the same contract `runAction` does and depends on no particular
 * implementation of the runner interface: nothing is mocked.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseFileCommands } from './github-file-commands.js';
import { parseWorkflowCommands } from './workflow-commands.js';

import type { WorkflowCommands } from './workflow-commands.js';

/** What an in-process run published. */
export interface InProcessResult extends WorkflowCommands {
  /** `process.exitCode` as the run left it: `1` after a failed step, `0` otherwise. */
  readonly exitCode: number;
  readonly outputs: Record<string, string>;
  readonly exportedEnv: Record<string, string>;
  /** Everything written to stdout during the run. */
  readonly stdout: string;
}

/** The runner's name for an input: `INPUT_` and the name upper-cased, spaces replaced by `_`. */
function inputVariable(name: string): string {
  return `INPUT_${name.replaceAll(' ', '_').toUpperCase()}`;
}

/**
 * Runs `body` with `inputs` and `env` in the environment and returns what it published.
 *
 * The environment, `process.exitCode` and stdout are restored afterwards, whatever `body` does.
 * Inputs and variables are set only for the duration of the call, so cases cannot leak into each
 * other.
 *
 * @param inputs - action inputs by name, as `action.yaml` declares them
 * @param body - the action's `run`, or anything that calls it
 * @param env - further variables, such as `RUNNER_TEMP` or `GITHUB_WORKSPACE`
 */
export async function runInProcess(
  inputs: Readonly<Record<string, string>>,
  body: () => unknown,
  env: Readonly<Record<string, string>> = {},
): Promise<InProcessResult> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'in-process-'));
  const outputFile = path.join(scratch, 'output');
  const envFile = path.join(scratch, 'env');
  writeFileSync(outputFile, '');
  writeFileSync(envFile, '');

  const variables: Record<string, string> = {
    ...env,
    GITHUB_OUTPUT: outputFile,
    GITHUB_ENV: envFile,
    ...Object.fromEntries(Object.entries(inputs).map(([name, value]) => [inputVariable(name), value])),
  };
  const saved = new Map(Object.keys(variables).map((key) => [key, process.env[key]]));
  const savedExitCode = process.exitCode;
  const write = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];

  process.exitCode = 0;
  Object.assign(process.env, variables);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));

    return true;
  }) as typeof process.stdout.write;

  try {
    await body();
    const stdout = chunks.join('');

    return {
      ...parseWorkflowCommands(stdout),
      exitCode: Number(process.exitCode ?? 0),
      outputs: parseFileCommands(readFileSync(outputFile, 'utf8')),
      exportedEnv: parseFileCommands(readFileSync(envFile, 'utf8')),
      stdout,
    };
  } finally {
    process.stdout.write = write;
    process.exitCode = savedExitCode;
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}
