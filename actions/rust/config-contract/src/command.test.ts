import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCommandRunner, stderrTail } from './command.js';

const run = createCommandRunner();

describe('stderrTail', () => {
  it('drops blank lines, which is most of what cargo writes', () => {
    expect(stderrTail('a\n\n\nb\n')).toBe('a\nb');
  });

  it('keeps only the tail, where the reason a command failed actually is', () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n');

    expect(stderrTail(lines).split('\n')).toHaveLength(20);
    expect(stderrTail(lines)).toContain('line 99');
    expect(stderrTail(lines)).not.toContain('line 79');
  });

  it('renders empty output as nothing rather than as a blank line', () => {
    expect(stderrTail('')).toBe('');
    expect(stderrTail('\n \n')).toBe('');
  });
});

describe('createCommandRunner', () => {
  /**
   * A copy of node under a space-free path, reachable by a bare name through PATH.
   *
   * `process.execPath` is `C:\Program Files\nodejs\node.exe` on a default Windows install, and
   * `@actions/exec` would re-split that into `C:\Program` plus an argument — the very footgun the
   * runner guards against. Running the real thing therefore needs a name that has no space in it.
   */
  let directory: string;
  let executable: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'config-contract-cmd-'));
    executable = path.join(directory, path.basename(process.execPath));
    await copyFile(process.execPath, executable);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('captures stdout without failing on a non-zero exit', async () => {
    const result = await run(executable, ['-e', 'process.stdout.write("out");process.exit(3)'], {});

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('out');
  });

  // A non-zero exit is data here, not an exception: a `docker cp` that cannot find the file is the
  // answer to the question being asked, and the caller decides what it means.
  it('captures stderr separately from stdout', async () => {
    const result = await run(executable, ['-e', 'process.stderr.write("boom")'], {});

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('boom');
    expect(result.stdout).toBe('');
  });

  it('runs in the directory it is given', async () => {
    const result = await run(executable, ['-e', 'process.stdout.write(process.cwd())'], { cwd: directory });

    expect(result.stdout).toBe(directory);
  });

  it('passes an argument holding whitespace as one argument', async () => {
    const result = await run(executable, ['-e', 'process.stdout.write(process.argv[1])', 'one two'], {});

    expect(result.stdout).toBe('one two');
  });

  // `@actions/exec` re-parses its first argument as a command line, so a tool path containing a
  // space becomes a different executable plus a stray argument. Refused rather than quoted: only
  // bare names are ever passed here, and a silent reinterpretation is the worst of the outcomes.
  it('refuses a command name that would be re-split into arguments', async () => {
    await expect(run('C:/Program Files/nodejs/node.exe', [], {})).rejects.toThrow(/not a bare executable name/);
  });
});
