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
import { StringDecoder } from 'node:string_decoder';

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
  // `write` normally lives on the stream's prototype; restoring the descriptor (or its absence) puts
  // back exactly what was there, rather than leaving a bound copy on the instance.
  const savedWrite = Object.getOwnPropertyDescriptor(process.stdout, 'write');
  // One decoder for the whole run, so a multi-byte character split across two writes survives.
  const decoder = new StringDecoder('utf8');
  const chunks: string[] = [];

  process.exitCode = 0;
  Object.assign(process.env, variables);
  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    chunks.push(decoder.write(typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk)));
    // A stream calls back asynchronously once the chunk is handled; a body may await it.
    if (done !== undefined) {
      process.nextTick(done);
    }

    return true;
  }) as typeof process.stdout.write;

  try {
    await body();
    const stdout = chunks.join('') + decoder.end();

    return {
      ...parseWorkflowCommands(stdout),
      exitCode: Number(process.exitCode ?? 0),
      outputs: parseFileCommands(readFileSync(outputFile, 'utf8')),
      exportedEnv: parseFileCommands(readFileSync(envFile, 'utf8')),
      stdout,
    };
  } finally {
    if (savedWrite === undefined) {
      delete (process.stdout as { write?: unknown }).write;
    } else {
      Object.defineProperty(process.stdout, 'write', savedWrite);
    }
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
