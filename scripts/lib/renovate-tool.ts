import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT_DIR } from './utils.js';

/**
 * The pinned Renovate install the Renovate checks run.
 *
 * It lives in its own package under `.github/` rather than in the root workspace, so the jobs that
 * do not need Renovate do not install it, and the preset's `.github/**` rules commit its updates as
 * `ci(deps)`.
 */
export const RENOVATE_TOOL_DIR = path.join(ROOT_DIR, '.github', 'tools', 'renovate');

export const RENOVATE_INSTALL_COMMAND = 'bun install --frozen-lockfile --cwd .github/tools/renovate';

/** Entry points of the `renovate` package, as its `bin` field maps them. */
export type RenovateEntry = 'config-validator' | 'renovate';

/** Absolute path of a Renovate entry point. Throws with the install command when it is missing. */
export function renovateEntry(entry: RenovateEntry, toolDir: string = RENOVATE_TOOL_DIR): string {
  const file = path.join(toolDir, 'node_modules', 'renovate', 'dist', `${entry}.js`);

  if (!fs.existsSync(file)) {
    throw new Error(`Renovate is not installed at ${toolDir}. Run '${RENOVATE_INSTALL_COMMAND}'.`);
  }

  return file;
}

export interface CommandOptions {
  cwd: string;
  /** Added to the inherited environment. */
  env?: Record<string, string>;
  /** Stream the output to this process instead of capturing it. */
  inherit?: boolean;
}

export interface CommandResult {
  exitCode: number;
  /** Captured stdout followed by stderr; empty when the output was inherited. */
  output: string;
}

/** Runs a command without a shell, so no argument is ever reinterpreted. */
export type CommandRunner = (command: readonly string[], options: CommandOptions) => Promise<CommandResult>;

export const runCommand: CommandRunner = (command, { cwd, env, inherit = false }) =>
  new Promise((resolve, reject) => {
    const [executable, ...args] = command;
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output: Buffer.concat([...stdout, ...stderr]).toString('utf8') });
    });
  });
