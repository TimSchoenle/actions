import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { runGit, runGitText } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

vi.mock('@actions/core', async (importOriginal) => ({
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
