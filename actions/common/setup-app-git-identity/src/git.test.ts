import { exec } from '@actions/exec';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGitIdentity, createGitConfigurator } from './git.js';

import type { GitConfigurator } from './git.js';
import type { BotIdentity } from 'actions-util';

vi.mock('@actions/exec');

const identity: BotIdentity = {
  email: '123456+my-app[bot]@users.noreply.github.com',
  id: 123456,
  name: 'my-app[bot]',
};

describe('createGitConfigurator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a repository-local config value via git', async () => {
    await createGitConfigurator().setLocalConfig('user.name', 'my-app[bot]');

    expect(exec).toHaveBeenCalledWith('git', ['config', 'user.name', 'my-app[bot]']);
  });

  it('does not pass --global, keeping the write scoped to the checkout', async () => {
    await createGitConfigurator().setLocalConfig('user.email', identity.email);

    const args = vi.mocked(exec).mock.calls[0]?.[1] ?? [];
    expect(args).not.toContain('--global');
  });
});

describe('configureGitIdentity', () => {
  it('sets both user.name and user.email from the identity', async () => {
    const calls: [string, string][] = [];
    const git: GitConfigurator = {
      setLocalConfig: vi.fn(async (key: string, value: string) => {
        calls.push([key, value]);
      }),
    };

    await configureGitIdentity(git, identity);

    expect(calls).toEqual([
      ['user.name', 'my-app[bot]'],
      ['user.email', '123456+my-app[bot]@users.noreply.github.com'],
    ]);
  });

  it('propagates a git failure instead of swallowing it', async () => {
    const git: GitConfigurator = {
      setLocalConfig: vi.fn(async () => {
        throw new Error('not a git repository');
      }),
    };

    await expect(configureGitIdentity(git, identity)).rejects.toThrow('not a git repository');
  });
});
