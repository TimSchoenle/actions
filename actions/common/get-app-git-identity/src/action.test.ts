import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { AppUserApi } from 'actions-util';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput` semantics — including the `required` check and the trimming the
 * runner's callers rely on — instead of a hand-written stand-in.
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

describe('get-app-git-identity action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes the name, email and id of the app bot', async () => {
    await run(fakeApi());

    expect(core.setOutput).toHaveBeenCalledWith('bot-name', 'my-app[bot]');
    expect(core.setOutput).toHaveBeenCalledWith('bot-email', '123456+my-app[bot]@users.noreply.github.com');
    expect(core.setOutput).toHaveBeenCalledWith('bot-id', '123456');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('publishes the id as a string, because that is all an action output can carry', async () => {
    await run(fakeApi());

    expect(core.setOutput).toHaveBeenCalledWith('bot-id', expect.any(String));
  });

  it('accepts a slug the caller already suffixed with [bot] and resolves the same identity', async () => {
    setInputs({ 'app-slug': 'my-app[bot]' });
    const api = fakeApi();

    await run(api);

    expect(api.getUserId).toHaveBeenCalledWith('my-app[bot]');
    expect(core.setOutput).toHaveBeenCalledWith('bot-name', 'my-app[bot]');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails with an actionable message when GitHub does not know the app bot', async () => {
    setInputs({ 'app-slug': 'typo-app' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("GitHub has no user 'typo-app[bot]'"));
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails when the app-slug input is empty', async () => {
    setInputs({ 'app-slug': '' });
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith('Input required and not supplied: app-slug');
    expect(api.getUserId).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails when the app-slug input holds nothing but whitespace', async () => {
    setInputs({ 'app-slug': '   ' });
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Invalid app-slug ''"));
    expect(api.getUserId).not.toHaveBeenCalled();
  });

  it('fails when the app-slug input is not a slug at all', async () => {
    setInputs({ 'app-slug': 'https://github.com/apps/my-app' });
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Invalid app-slug 'https://github.com/apps/my-app'"),
    );
    expect(api.getUserId).not.toHaveBeenCalled();
  });

  it('fails when the token input is empty', async () => {
    setInputs({ token: '' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith('Input required and not supplied: token');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  // An unusable token demands a different fix than a wrong slug, so it must never be reported as one.
  it('fails with the API error when the lookup itself fails', async () => {
    const failing: AppUserApi = {
      getUserId: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
    };

    await run(failing);

    expect(core.setFailed).toHaveBeenCalledWith('Bad credentials');
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});
