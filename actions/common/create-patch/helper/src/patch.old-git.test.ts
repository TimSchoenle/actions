import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from 'actions-util/core';
import { PATCH_FILE_NAME, runGit, runGitText } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPatch } from './patch.js';

import type * as patchModule from 'actions-util/patch';

// Reports a git release older than `--attr-source` (2.42), as a self-hosted runner on a distribution
// git might; every other git call runs for real.
vi.mock('actions-util/patch', async (importOriginal) => {
  const actual = await importOriginal<typeof patchModule>();

  return {
    ...actual,
    runGitText: (args: string[], options: Parameters<typeof actual.runGitText>[1]) =>
      args[0] === 'version' ? Promise.resolve('git version 2.34.1') : actual.runGitText(args, options),
  };
});

vi.mock('actions-util/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  warning: vi.fn(),
}));

let root: string;
let repo: string;
let output: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'create-patch-old-git-'));
  repo = path.join(root, 'repo');
  output = path.join(root, 'out');
  await runGit(['init', '--quiet', '--initial-branch=main', repo], { cwd: root });
  await mkdir(output);
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(root, { force: true, recursive: true });
});

describe('createPatch on git older than 2.42', () => {
  /**
   * `--attr-source` is a usage error before git 2.42, so passing it unconditionally failed every patch
   * on such a runner.
   */
  it('omits --attr-source, follows .gitattributes as before, and warns', async () => {
    const git = (...args: string[]): Promise<string> => runGitText(args, { cwd: repo });
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(path.join(repo, '.gitattributes'), 'lock.json -diff\n');
    await writeFile(path.join(repo, 'lock.json'), '{"v":1}\n');
    await git('add', '--all');
    await git('commit', '--quiet', '-m', 'seed');
    await writeFile(path.join(repo, 'lock.json'), '{"v":2}\n');

    const metadata = await createPatch({
      maxPatchBytes: 1024 * 1024,
      outputDirectory: output,
      paths: '.',
      scratchRoot: root,
      workspace: repo,
    });

    expect(metadata.hasChanges).toBe(true);
    expect(await readFile(path.join(output, PATCH_FILE_NAME), 'utf8')).toContain('GIT binary patch');
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('older than 2.42'));
  });
});
