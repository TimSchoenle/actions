import { exec, getExecOutput } from '@actions/exec';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGit } from './git.js';

vi.mock('@actions/exec');

describe('createGit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getExecOutput).mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
  });

  it('disables file-mode tracking with a repository-local config write', async () => {
    await createGit().ignoreFileModeChanges();

    expect(exec).toHaveBeenCalledWith('git', ['config', 'core.fileMode', 'false']);
  });

  it('lists the whole tree with untracked files and renames decomposed', async () => {
    await createGit().status();

    expect(getExecOutput).toHaveBeenCalledWith('git', ['status', '--porcelain', '-z', '-uall', '--no-renames'], {
      silent: true,
    });
  });

  it('scopes the status to the given pathspecs after a -- separator', async () => {
    await createGit().status([':(glob)src/*.ts', 'Chart.yaml']);

    expect(getExecOutput).toHaveBeenCalledWith(
      'git',
      ['status', '--porcelain', '-z', '-uall', '--no-renames', '--', ':(glob)src/*.ts', 'Chart.yaml'],
      { silent: true },
    );
  });

  it('does not add a -- separator for an empty pathspec list', async () => {
    await createGit().status([]);

    const args = vi.mocked(getExecOutput).mock.calls[0]?.[1] ?? [];
    expect(args).not.toContain('--');
  });

  it('returns the raw stdout of git status', async () => {
    vi.mocked(getExecOutput).mockResolvedValue({ exitCode: 0, stderr: '', stdout: ' M a.ts\0' });

    await expect(createGit().status()).resolves.toBe(' M a.ts\0');
  });
});
