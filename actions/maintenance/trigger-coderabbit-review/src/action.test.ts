import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { createTriggerApi } from './github-api.js';

import type { PullRequestInfo, TriggerApi } from './github-api.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so the tests
 * exercise the actual `getInput` semantics, including `required` and boolean parsing.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

// Only the factory is replaced, so a case can run without an injected API and still reach no network.
vi.mock('./github-api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./github-api.js')>()),
  createTriggerApi: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  command: 'review',
  pr_url: 'https://github.com/owner/repo/pull/7',
  reject_forks: 'true',
  skip_authors: '',
  skip_bots: 'true',
  skip_drafts: 'true',
  token: 'github_pat_test',
};

const openPullRequest: PullRequestInfo = {
  authorLogin: 'alice',
  authorType: 'User',
  baseRepoFullName: 'owner/repo',
  draft: false,
  headRepoFullName: 'owner/repo',
  state: 'open',
};

function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function fakeApi(pullRequest: PullRequestInfo = openPullRequest): TriggerApi {
  return {
    getPullRequest: vi.fn(async () => pullRequest),
    getTokenIdentity: vi.fn(async () => ({ login: 'owner-user', type: 'User' })),
    postComment: vi.fn(async () => ({ id: 1, url: 'https://github.com/owner/repo/pull/7#issuecomment-1' })),
  };
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls.map(([name, value]) => [name, String(value)]));
}

describe('trigger-coderabbit-review action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('posts the command and publishes the comment URL', async () => {
    const api = fakeApi();

    await run(api);

    expect(api.postComment).toHaveBeenCalledWith({ number: 7, owner: 'owner', repo: 'repo' }, '@coderabbitai review');
    expect(outputs()).toEqual({
      comment_url: 'https://github.com/owner/repo/pull/7#issuecomment-1',
      skip_reason: '',
      triggered: 'true',
    });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('publishes the skip reason and posts nothing', async () => {
    const api = fakeApi({ ...openPullRequest, authorLogin: 'renovate[bot]', authorType: 'Bot' });

    await run(api);

    expect(api.postComment).not.toHaveBeenCalled();
    expect(outputs()).toEqual({ comment_url: '', skip_reason: 'bot-author', triggered: 'false' });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('passes skip_authors through', async () => {
    setInputs({ skip_authors: 'someone,\nAlice' });
    const api = fakeApi();

    await run(api);

    expect(outputs()).toMatchObject({ skip_reason: 'skipped-author', triggered: 'false' });
  });

  it('honours a disabled skip rule', async () => {
    setInputs({ skip_drafts: 'false' });
    const api = fakeApi({ ...openPullRequest, draft: true });

    await run(api);

    expect(outputs()).toMatchObject({ triggered: 'true' });
  });

  it.each([
    ['command', { command: 'resume' }, 'Invalid command'],
    ['pr_url', { pr_url: 'https://github.com/owner/repo/issues/7' }, 'Invalid pull request URL'],
    ['skip_drafts', { skip_drafts: 'maybe' }, 'skip_drafts'],
  ])('fails on an invalid %s before calling the API', async (_input, overrides, message) => {
    setInputs(overrides);
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(api.getTokenIdentity).not.toHaveBeenCalled();
  });

  it('fails when the token is not a user token', async () => {
    const api = { ...fakeApi(), getTokenIdentity: vi.fn(async () => undefined) };

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('CodeRabbit ignores commands'));
    expect(api.postComment).not.toHaveBeenCalled();
    expect(outputs()).toEqual({});
  });

  it('builds the API from the token when none is injected', async () => {
    vi.mocked(createTriggerApi).mockReturnValue(fakeApi());

    await run();

    expect(createTriggerApi).toHaveBeenCalledWith('github_pat_test');
  });
});
