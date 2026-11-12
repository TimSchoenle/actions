import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ROOT_DIR } from '../lib/utils.js';

/**
 * How `actions/bun/setup-cached` resolves `cache-mode: auto`, run as the runner runs its step: `bash -e`
 * with the inputs in the environment and a `GITHUB_OUTPUT` file. Lives here rather than beside the
 * action, so a change to it does not release the action.
 */

function modeScript(): string {
  const manifest = parse(fs.readFileSync(path.join(ROOT_DIR, 'actions/bun/setup-cached/action.yaml'), 'utf8')) as {
    runs: { steps: { id?: string; run?: string }[] };
  };
  const step = manifest.runs.steps.find((candidate) => candidate.id === 'mode');
  if (step?.run === undefined) {
    throw new Error('bun/setup-cached has no mode step');
  }

  return step.run;
}

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** The mode the step resolves for `auto` on `event`. */
function autoMode(event: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-cached-mode-'));
  directories.push(directory);
  const output = path.join(directory, 'output');
  fs.writeFileSync(output, '');
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', modeScript()], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'], CACHE_MODE: 'auto', EVENT_NAME: event, GITHUB_OUTPUT: output },
  });
  expect(result.status, result.stderr).toBe(0);

  return fs.readFileSync(output, 'utf8').trim();
}

describe('bun/setup-cached cache-mode auto', () => {
  it.each(['push', 'schedule', 'workflow_dispatch'])('saves on %s', (event) => {
    expect(autoMode(event)).toBe('value=read-write');
  });

  // P14d: a merge queue run saved into the scope of a gh-readonly-queue ref that is deleted once the
  // group merges, so no later run could restore the entry.
  it.each(['merge_group', 'pull_request', 'pull_request_target', 'workflow_run'])('only reads on %s', (event) => {
    expect(autoMode(event)).toBe('value=read-only');
  });
});
