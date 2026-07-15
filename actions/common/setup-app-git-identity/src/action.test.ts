import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { GitConfigurator } from './git.js';
import type { AppUserApi } from 'actions-util';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput` semantics — including the `required` check — instead of a
 * hand-written stand-in.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  'app-slug': 'my-app',
  token: 'ghs_test_token',
};

/** Publishes the inputs the way the Actions runner does: as `INPUT_*` environment variables. */
function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function fakeApi(users: Record<string, number> = { 'my-app[bot]': 123456 }): AppUserApi {
  return {
    getUserId: vi.fn(async (username: string) => users[username]),
  };
}

function fakeGit(): GitConfigurator & { calls: [string, string][] } {
  const calls: [string, string][] = [];
  return {
    calls,
    setLocalConfig: vi.fn(async (key: string, value: string) => {
      calls.push([key, value]);
    }),
  };
}

describe('setup-app-git-identity action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('configures git with the bot identity and publishes its details', async () => {
    const git = fakeGit();

    await run({ api: fakeApi(), git });

    expect(git.calls).toEqual([
      ['user.name', 'my-app[bot]'],
      ['user.email', '123456+my-app[bot]@users.noreply.github.com'],
    ]);
    expect(core.setOutput).toHaveBeenCalledWith('bot-name', 'my-app[bot]');
    expect(core.setOutput).toHaveBeenCalledWith('bot-email', '123456+my-app[bot]@users.noreply.github.com');
    expect(core.setOutput).toHaveBeenCalledWith('bot-id', '123456');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('accepts a slug the caller already suffixed with [bot]', async () => {
    setInputs({ 'app-slug': 'my-app[bot]' });
    const api = fakeApi();

    await run({ api, git: fakeGit() });

    expect(api.getUserId).toHaveBeenCalledWith('my-app[bot]');
    expect(core.setOutput).toHaveBeenCalledWith('bot-name', 'my-app[bot]');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('does not touch git or publish outputs when the bot user does not exist', async () => {
    setInputs({ 'app-slug': 'typo-app' });
    const git = fakeGit();

    await run({ api: fakeApi(), git });

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("GitHub has no user 'typo-app[bot]'"));
    expect(git.setLocalConfig).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails when the app-slug input is empty', async () => {
    setInputs({ 'app-slug': '' });
    const api = fakeApi();

    await run({ api, git: fakeGit() });

    expect(core.setFailed).toHaveBeenCalledWith('Input required and not supplied: app-slug');
    expect(api.getUserId).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails when the token input is empty', async () => {
    setInputs({ token: '' });
    const git = fakeGit();

    await run({ api: fakeApi(), git });

    expect(core.setFailed).toHaveBeenCalledWith('Input required and not supplied: token');
    expect(git.setLocalConfig).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails with the API error when the lookup itself fails, without configuring git', async () => {
    const failing: AppUserApi = {
      getUserId: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
    };
    const git = fakeGit();

    await run({ api: failing, git });

    expect(core.setFailed).toHaveBeenCalledWith('Bad credentials');
    expect(git.setLocalConfig).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});
