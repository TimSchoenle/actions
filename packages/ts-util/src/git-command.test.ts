import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitCommandError, runGit, runGitText } from './git-command.js';

describe('runGit', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'git-command-'));
    await runGit(['init', '--quiet'], { cwd: directory });
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('returns standard output as raw bytes, including bytes that are not UTF-8', async () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x41]);
    await writeFile(path.join(directory, 'blob'), bytes);

    const sha = await runGitText(['hash-object', '-w', 'blob'], { cwd: directory });
    const read = await runGit(['cat-file', 'blob', sha], { cwd: directory });

    expect(read.equals(bytes)).toBe(true);
  });

  it('trims the decoded text for one-line answers', async () => {
    await expect(runGitText(['rev-parse', '--is-inside-work-tree'], { cwd: directory })).resolves.toBe('true');
  });

  it('passes extra environment to git', async () => {
    const index = path.join(directory, 'scratch-index');

    await runGit(['read-tree', '--empty'], { cwd: directory, env: { GIT_INDEX_FILE: index } });

    await expect(runGitText(['ls-files'], { cwd: directory, env: { GIT_INDEX_FILE: index } })).resolves.toBe('');
  });

  it('rejects with the command and its standard error when git exits non-zero', async () => {
    const failure = runGit(['rev-parse', '--verify', 'no-such-ref'], { cwd: directory });

    await expect(failure).rejects.toBeInstanceOf(GitCommandError);
    await expect(failure).rejects.toMatchObject({
      args: ['rev-parse', '--verify', 'no-such-ref'],
      outputLimitExceeded: false,
    });
    await expect(failure).rejects.toThrow(/^git rev-parse failed: .+/);
  });

  it('stops git and flags the limit when its output exceeds maxOutputBytes', async () => {
    await writeFile(path.join(directory, 'big'), 'x'.repeat(4096));
    const sha = await runGitText(['hash-object', '-w', 'big'], { cwd: directory });

    const failure = runGit(['cat-file', 'blob', sha], { cwd: directory, maxOutputBytes: 1024 });

    await expect(failure).rejects.toMatchObject({ outputLimitExceeded: true });
    await expect(failure).rejects.toThrow('its output exceeded the size limit');
  });

  it('never interprets an argument through a shell', async () => {
    const failure = runGit(['rev-parse', '--verify', '$(touch pwned)'], { cwd: directory });

    await expect(failure).rejects.toBeInstanceOf(GitCommandError);
    await expect(runGitText(['status', '--porcelain'], { cwd: directory })).resolves.toBe('');
  });
});
