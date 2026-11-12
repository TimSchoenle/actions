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

  describe('checkedOutHead', () => {
    function answer(symbolicRef: { exitCode: number; stdout: string }, head = `${'c'.repeat(40)}\n`): void {
      vi.mocked(getExecOutput).mockImplementation(async (_command, args) =>
        args?.[0] === 'symbolic-ref' ? { ...symbolicRef, stderr: '' } : { exitCode: 0, stderr: '', stdout: head },
      );
    }

    it('returns HEAD when the branch is checked out', async () => {
      answer({ exitCode: 0, stdout: 'refs/heads/main\n' });

      await expect(createGit().checkedOutHead('main')).resolves.toBe('c'.repeat(40));
      expect(getExecOutput).toHaveBeenCalledWith('git', ['symbolic-ref', '--quiet', 'HEAD'], {
        ignoreReturnCode: true,
        silent: true,
      });
      expect(getExecOutput).toHaveBeenCalledWith('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { silent: true });
    });

    it('returns nothing when another branch is checked out', async () => {
      answer({ exitCode: 0, stdout: 'refs/heads/feature\n' });

      await expect(createGit().checkedOutHead('main')).resolves.toBeUndefined();
    });

    it('compares full ref names, so a branch named like a ref does not match', async () => {
      answer({ exitCode: 0, stdout: 'refs/heads/refs/heads/main\n' });

      await expect(createGit().checkedOutHead('main')).resolves.toBeUndefined();
    });

    it('returns nothing for a detached HEAD', async () => {
      answer({ exitCode: 1, stdout: '' });

      await expect(createGit().checkedOutHead('main')).resolves.toBeUndefined();
    });
  });

  it('returns the raw stdout of git status', async () => {
    vi.mocked(getExecOutput).mockResolvedValue({ exitCode: 0, stderr: '', stdout: ' M a.ts\0' });

    await expect(createGit().status()).resolves.toBe(' M a.ts\0');
  });
});
