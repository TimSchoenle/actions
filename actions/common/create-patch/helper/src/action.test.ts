import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from 'actions-util/core';
import { describePatch, runGit, runGitText } from 'actions-util/patch';
import { readPatchArtifact } from 'actions-util/patch-reader';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

vi.mock('actions-util/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  debug: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

let root: string;
let repo: string;
let temp: string;
let base: string;

function outputs(): Record<string, unknown> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'create-patch-action-'));
  repo = path.join(root, 'repo');
  temp = path.join(root, 'temp');
  await mkdir(repo);
  await mkdir(temp);

  await runGit(['init', '--quiet'], { cwd: repo });
  await runGit(
    ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '--quiet', '--allow-empty', '-m', 'seed'],
    {
      cwd: repo,
    },
  );
  base = await runGitText(['rev-parse', 'HEAD'], { cwd: repo });

  vi.stubEnv('INPUT_ARTIFACT_NAME', 'update-files-builds');
  vi.stubEnv('INPUT_PATHS', '.');
  vi.stubEnv('INPUT_MAX_PATCH_BYTES', '10485760');
  vi.stubEnv('INPUT_EMPTY_BASE_SHA', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(root, { force: true, recursive: true });
});

describe('run', () => {
  it('publishes the outputs and writes the artifact under the runner temp directory', async () => {
    await writeFile(path.join(repo, 'new.txt'), 'n\n');

    await run({ temp, workspace: repo });

    expect(core.setFailed).not.toHaveBeenCalled();
    const published = outputs();
    expect(published).toMatchObject({ artifact_name: 'update-files-builds', base_sha: base, has_changes: 'true' });

    const directory = String(published['directory']);
    expect(path.dirname(directory)).toBe(temp);
    expect(path.basename(directory)).toMatch(/^create-patch-update-files-builds-/);
    expect((await readdir(directory)).sort()).toEqual(['changes.patch', 'metadata.json']);
  });

  it('reports has_changes false for a clean tree', async () => {
    await run({ temp, workspace: repo });

    expect(outputs()).toMatchObject({ has_changes: 'false' });
  });

  it.each(['../escape', 'a/b', ''])('fails on the artifact name %j before touching the repository', async (name) => {
    vi.stubEnv('INPUT_ARTIFACT_NAME', name);

    await run({ temp, workspace: repo });

    expect(core.setFailed).toHaveBeenCalledOnce();
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(await readdir(temp)).toEqual([]);
  });

  describe('with empty_base_sha', () => {
    const SHA = 'a'.repeat(40);

    // No checkout: the workspace is a directory that is not a repository.
    it('writes an empty patch for that commit without reading a checkout', async () => {
      vi.stubEnv('INPUT_EMPTY_BASE_SHA', SHA);
      const notARepository = path.join(root, 'empty');
      await mkdir(notARepository);

      await run({ temp, workspace: notARepository });

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(outputs()).toMatchObject({ artifact_name: 'update-files-builds', base_sha: SHA, has_changes: 'false' });
      const directory = String(outputs()['directory']);
      expect(path.dirname(directory)).toBe(temp);
      expect(await readFile(path.join(directory, 'changes.patch'))).toHaveLength(0);
      expect(await readPatchArtifact(directory, 1024)).toEqual({
        metadata: describePatch(SHA, Buffer.alloc(0)),
        patchPath: path.join(directory, 'changes.patch'),
      });
    });

    it('ignores changes in the checkout', async () => {
      vi.stubEnv('INPUT_EMPTY_BASE_SHA', SHA);
      await writeFile(path.join(repo, 'new.txt'), 'n\n');

      await run({ temp, workspace: repo });

      expect(outputs()).toMatchObject({ base_sha: SHA, has_changes: 'false' });
    });

    it.each(['abc1234', 'A'.repeat(40), `${SHA}\n`, 'main'])('fails on %j before writing anything', async (value) => {
      vi.stubEnv('INPUT_EMPTY_BASE_SHA', value);

      await run({ temp, workspace: repo });

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('empty_base_sha must be a full'));
      expect(await readdir(temp)).toEqual([]);
    });
  });

  it('fails on a malformed size limit', async () => {
    vi.stubEnv('INPUT_MAX_PATCH_BYTES', '10MB');

    await run({ temp, workspace: repo });

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('max_patch_bytes must be a positive whole number'),
    );
  });
});

describe('run without an explicit context', () => {
  it('reads the workspace and the temp directory from the runner environment', async () => {
    vi.stubEnv('GITHUB_WORKSPACE', repo);
    vi.stubEnv('RUNNER_TEMP', temp);
    await writeFile(path.join(repo, 'new.txt'), 'n\n');

    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()).toMatchObject({ base_sha: base, has_changes: 'true' });
    expect(path.dirname(String(outputs()['directory']))).toBe(temp);
  });

  it('falls back to the working directory and the system temp directory outside a runner', async () => {
    vi.stubEnv('GITHUB_WORKSPACE', '');
    vi.stubEnv('RUNNER_TEMP', '');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(repo);

    try {
      await run();
    } finally {
      cwd.mockRestore();
    }

    expect(core.setFailed).not.toHaveBeenCalled();
    const directory = String(outputs()['directory']);
    expect(outputs()).toMatchObject({ base_sha: base, has_changes: 'false' });
    expect(path.dirname(directory)).toBe(tmpdir());
    await rm(directory, { force: true, recursive: true });
  });
});
