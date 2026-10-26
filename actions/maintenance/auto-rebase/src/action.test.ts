import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { PullRequestDetail, UpdateBranchApi } from './github-api.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so the tests
 * exercise the actual `getInput` semantics, including `required` and boolean parsing.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  error: vi.fn(),
  info: vi.fn(),
  notice: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  fail_on_error: 'true',
  label: 'dependencies',
  repository: 'owner/repo',
  skip_drafts: 'false',
  token: 'ghs_test_token',
};

function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function detail(number: number, overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    baseRef: 'main',
    baseRepoFullName: 'owner/repo',
    draft: false,
    headRepoFullName: 'owner/repo',
    headSha: `sha-${number}`,
    labels: ['dependencies'],
    maintainerCanModify: false,
    number,
    state: 'open',
    ...overrides,
  };
}

/** Pull requests 1 to 4 carry the label; 4 is a draft. Pull request 9 does not. */
function fakeApi(): UpdateBranchApi {
  return {
    commitsBehindBase: vi.fn(async (_repository, _base, headSha: string) => (headSha === 'sha-2' ? 0 : 1)),
    getPullRequest: vi.fn(async (_repository, number: number) => detail(number, { draft: number === 4 })),
    listOpenPullRequests: vi.fn(async () => [
      { labels: ['dependencies'], number: 1 },
      { labels: ['dependencies'], number: 2 },
      { labels: ['dependencies'], number: 3 },
      { labels: ['dependencies'], number: 4 },
      { labels: ['bug'], number: 9 },
    ]),
    updateBranch: vi.fn(async () => {}),
  };
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls.map(([name, value]) => [name, String(value)]));
}

describe('auto-rebase action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
    // Keeps every case off the runner's own job summary unless it opts in.
    vi.stubEnv('GITHUB_STEP_SUMMARY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    core.summary.emptyBuffer();
  });

  it('publishes the updated, skipped and failed pull requests as JSON arrays', async () => {
    const api = fakeApi();
    vi.mocked(api.updateBranch).mockImplementation(async (_repository, number) => {
      if (number === 3) {
        throw httpError(422, 'merge conflict between base and head');
      }
    });

    await run(api);

    expect(outputs()).toEqual({ failed: '[3]', skipped: '[2]', updated: '[1,4]' });
    expect(api.listOpenPullRequests).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });
    // A rejected update is the expected way for a conflicting pull request to end up.
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('#3: GitHub rejected the update'));
  });

  it('skips drafts when skip_drafts is true', async () => {
    setInputs({ skip_drafts: 'true' });

    await run(fakeApi());

    expect(outputs()).toEqual({ failed: '[]', skipped: '[2,4]', updated: '[1,3]' });
  });

  it('publishes empty arrays and a notice when nothing carries the label', async () => {
    setInputs({ label: 'no-such-label' });

    await run(fakeApi());

    expect(outputs()).toEqual({ failed: '[]', skipped: '[]', updated: '[]' });
    expect(core.notice).toHaveBeenCalledWith('No open pull request carries the label "no-such-label".');
  });

  describe('unexpected errors', () => {
    it('fail the step after every pull request was processed', async () => {
      const api = fakeApi();
      vi.mocked(api.updateBranch).mockRejectedValueOnce(httpError(403, 'Resource not accessible by integration'));

      await run(api);

      expect(api.updateBranch).toHaveBeenCalledTimes(3);
      expect(outputs()).toEqual({ failed: '[1]', skipped: '[2]', updated: '[3,4]' });
      expect(core.setFailed).toHaveBeenCalledWith('The update of #1 failed with an unexpected error.');
    });

    it('only warn when fail_on_error is false', async () => {
      setInputs({ fail_on_error: 'false' });
      const api = fakeApi();
      vi.mocked(api.updateBranch).mockRejectedValue(httpError(500, 'Server Error'));

      await run(api);

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledWith(
        'The update of #1, #3, #4 failed with an unexpected error; continuing because fail_on_error is false.',
      );
    });
  });

  it('fails when the pull requests cannot be listed', async () => {
    const api = fakeApi();
    vi.mocked(api.listOpenPullRequests).mockRejectedValue(new Error('Bad credentials'));

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith('Bad credentials');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails on a malformed repository', async () => {
    setInputs({ repository: 'https://github.com/owner/repo' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid repository'));
  });

  it.each(['token', 'label', 'repository'])('fails when the required input %s is missing', async (name) => {
    setInputs({ [name]: '' });
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(`Input required and not supplied: ${name}`);
    expect(api.listOpenPullRequests).not.toHaveBeenCalled();
  });

  // `core.summary` is a module singleton that caches the first GITHUB_STEP_SUMMARY it reads, and on a
  // runner that variable is already set for the whole test process. The write is therefore stubbed
  // and the rendered markdown read from the call, rather than from whichever file the cache points at.
  it('writes the job summary when the runner provides one', async () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', '/runner/step-summary.md');
    const addRaw = vi.spyOn(core.summary, 'addRaw');
    const write = vi.spyOn(core.summary, 'write').mockResolvedValue(core.summary);

    await run(fakeApi());

    expect(write).toHaveBeenCalledTimes(1);
    expect(addRaw).toHaveBeenCalledWith(expect.stringContaining('| #2 | skipped | already contains its base |'));
  });

  it('writes no job summary outside a runner', async () => {
    const write = vi.spyOn(core.summary, 'write');

    await run(fakeApi());

    expect(write).not.toHaveBeenCalled();
  });
});
