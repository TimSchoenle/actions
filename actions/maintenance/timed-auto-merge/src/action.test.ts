import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { createTimedAutoMergeApi } from './github-api.js';

import type { OpenPullRequest, TimedAutoMergeApi } from './github-api.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real, so the tests
 * exercise `getInput` and `getBooleanInput` as the runner would drive them.
 */
const summaryWrite = vi.fn(async () => {});
const summaryAddRaw = vi.fn((_text: string) => ({ write: summaryWrite }));

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  debug: vi.fn(),
  endGroup: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  startGroup: vi.fn(),
  summary: { addRaw: (text: string) => summaryAddRaw(text) },
  warning: vi.fn(),
}));

vi.mock('./github-api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./github-api.js')>()),
  createTimedAutoMergeApi: vi.fn(),
}));

const NOW = Date.parse('2026-10-26T12:00:00Z');
const HEAD = 'a'.repeat(40);

const defaultInputs: Record<string, string> = {
  approve_message: 'Auto-approved.',
  branch_pattern: 'release-please--branches--%',
  fail_on_error: 'true',
  merge_method: 'squash',
  minimum_age: '1h',
  pattern_mode: 'legacy',
  repository: 'owner/repo',
  time_elapsed: '1d',
  token: 'ghs_test_token',
  trusted_authors: '1001',
};

function setInputs(overrides: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function pullRequest(number: number, overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    baseRepoFullName: 'owner/repo',
    createdAt: '2026-10-20T00:00:00Z',
    draft: false,
    headRef: 'release-please--branches--main',
    headRepoFullName: 'owner/repo',
    headSha: HEAD,
    nodeId: `PR_${number}`,
    number,
    url: `https://github.com/owner/repo/pull/${number}`,
    ...overrides,
  };
}

function fakeApi(pullRequests: OpenPullRequest[]): TimedAutoMergeApi {
  return {
    approve: vi.fn(async () => {}),
    enableAutoMerge: vi.fn(async () => {}),
    getMergeState: vi.fn(async () => ({ headOid: HEAD, status: 'BLOCKED' })),
    merge: vi.fn(async () => {}),
    fetchCommits: vi.fn(async () => ({
      commits: [
        {
          authorIds: [1001],
          committerId: 1001,
          oid: HEAD,
          signatureState: 'VALID',
          signatureValid: true,
          signedByGitHub: false,
          signerId: 1001,
        },
      ],
      headOid: HEAD,
      totalCount: 1,
    })),
    latestBranchUpdate: vi.fn(async () => ({ sha: HEAD, timestamp: '2026-01-01T00:00:00Z' })),
    listOpenPullRequests: vi.fn(async () => pullRequests),
  };
}

function output(name: string): string | undefined {
  return vi
    .mocked(core.setOutput)
    .mock.calls.filter((call) => call[0] === name)
    .at(-1)?.[1] as string | undefined;
}

function failure(): string | undefined {
  return vi.mocked(core.setFailed).mock.calls.at(-1)?.[0] as string | undefined;
}

describe('timed-auto-merge action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('approves eligible pull requests and publishes every outcome', async () => {
    setInputs();
    const api = fakeApi([
      pullRequest(1),
      pullRequest(2, { createdAt: '2026-10-26T11:00:00Z' }),
      pullRequest(3, { headRef: 'feature/x' }),
    ]);

    await run({ api, now: () => NOW });

    expect(failure()).toBeUndefined();
    expect(output('approved')).toBe('[1]');
    expect(output('skipped')).toBe('[{"number":2,"reason":"too-young"}]');
    expect(output('failed')).toBe('[]');
    expect(api.approve).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 1, HEAD, 'Auto-approved.');
    expect(api.enableAutoMerge).toHaveBeenCalledWith('PR_1', 'squash', HEAD);
    expect(summaryAddRaw).toHaveBeenCalledWith(expect.stringContaining('2 of 3 open pull request(s) matched'));
    expect(summaryWrite).toHaveBeenCalledTimes(1);
  });

  it('merges a pull request directly when it is already mergeable and logs that it did', async () => {
    setInputs();
    const api = fakeApi([pullRequest(1)]);
    vi.mocked(api.enableAutoMerge).mockRejectedValueOnce(new Error('Pull request Pull request is in clean status'));
    vi.mocked(api.getMergeState).mockResolvedValueOnce({ headOid: HEAD, status: 'CLEAN' });

    await run({ api, now: () => NOW });

    expect(failure()).toBeUndefined();
    expect(output('approved')).toBe('[1]');
    expect(api.merge).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 1, 'squash', HEAD);
    expect(core.info).toHaveBeenCalledWith(
      `#1 "release-please--branches--main": approved at ${HEAD} and merged, since it was already mergeable.`,
    );
  });

  it('fails the step after processing everything when an API call failed', async () => {
    setInputs();
    const api = fakeApi([pullRequest(1), pullRequest(2)]);
    vi.mocked(api.approve).mockRejectedValueOnce(new Error('Resource not accessible by integration'));

    await run({ api, now: () => NOW });

    expect(api.enableAutoMerge).toHaveBeenCalledTimes(1);
    expect(output('approved')).toBe('[2]');
    expect(output('failed')).toBe('[{"message":"Resource not accessible by integration","number":1}]');
    expect(failure()).toBe('1 pull request(s) could not be processed because an API call failed.');
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Resource not accessible by integration'));
  });

  it('only warns about a failed API call when fail_on_error is false', async () => {
    setInputs({ fail_on_error: 'false' });
    const api = fakeApi([pullRequest(1)]);
    vi.mocked(api.fetchCommits).mockRejectedValueOnce(new Error('timeout'));

    await run({ api, now: () => NOW });

    expect(failure()).toBeUndefined();
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Continuing because fail_on_error is false'));
    expect(output('failed')).toBe('[{"message":"timeout","number":1}]');
  });

  it('does not fail the step for skipped pull requests', async () => {
    setInputs();
    const api = fakeApi([pullRequest(1, { draft: true })]);

    await run({ api, now: () => NOW });

    expect(failure()).toBeUndefined();
    expect(output('skipped')).toBe('[{"number":1,"reason":"draft"}]');
  });

  it.each([
    ['an unknown merge method', { merge_method: 'admin' }, /Invalid 'merge_method' "admin"/],
    [
      'time_elapsed below minimum_age',
      { time_elapsed: '0s' },
      /'time_elapsed' "0s" is shorter than 'minimum_age' "1h"/,
    ],
    ['a malformed time_elapsed', { time_elapsed: '1 day' }, /Invalid 'time_elapsed'/],
    ['a malformed minimum_age', { minimum_age: '' }, /Invalid 'minimum_age'/],
    ['an unknown pattern mode', { pattern_mode: 'glob' }, /Invalid 'pattern_mode'/],
    ['an empty branch pattern', { branch_pattern: '' }, /must not be empty/],
    ['an uncompilable branch pattern', { branch_pattern: '(' }, /Invalid branch pattern/],
    [
      'a non-numeric trusted author',
      { trusted_authors: 'octocat' },
      /Invalid 'trusted_authors': Invalid user ID 'octocat'/,
    ],
    ['no trusted authors', { trusted_authors: ' , ' }, /Invalid 'trusted_authors'/],
    ['a malformed repository', { repository: 'owner' }, /Invalid repository 'owner'/],
    ['an empty approve message', { approve_message: ' ' }, /'approve_message' must not be empty/],
    ['a non-boolean fail_on_error', { fail_on_error: 'maybe' }, /fail_on_error/],
  ])('rejects %s before any API call', async (_name, overrides, message) => {
    setInputs(overrides);
    const api = fakeApi([pullRequest(1)]);

    await run({ api, now: () => NOW });

    expect(failure()).toMatch(message);
    expect(api.listOpenPullRequests).not.toHaveBeenCalled();
  });

  it('fails the step when the listing fails, publishing nothing', async () => {
    setInputs();
    const api = fakeApi([]);
    vi.mocked(api.listOpenPullRequests).mockRejectedValueOnce(new Error('Bad credentials'));

    await run({ api, now: () => NOW });

    expect(failure()).toBe('Bad credentials');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('logs hostile branch names quoted onto one line', async () => {
    setInputs({ branch_pattern: '%', pattern_mode: 'legacy' });
    const api = fakeApi([pullRequest(1, { draft: true, headRef: 'x\n::error::forged' })]);

    await run({ api, now: () => NOW });

    const lines = vi.mocked(core.info).mock.calls.map(([line]) => String(line));
    expect(lines).toContain('#1 "x\\n::error::forged": skipped (draft): "pull request is a draft"');
    expect(lines.some((line) => line.split('\n').some((part) => part.startsWith('::')))).toBe(false);
  });

  it('uses the real clock when none is injected', async () => {
    setInputs();
    const api = fakeApi([pullRequest(1, { createdAt: new Date(Date.now() + 60_000).toISOString() })]);

    await run({ api });

    expect(output('skipped')).toBe('[{"number":1,"reason":"too-young"}]');
  });

  it('binds the GitHub API to the token input when no API is injected', async () => {
    setInputs();
    const api = fakeApi([pullRequest(1)]);
    vi.mocked(createTimedAutoMergeApi).mockReturnValue(api);

    await run({ now: () => NOW });

    expect(createTimedAutoMergeApi).toHaveBeenCalledWith('ghs_test_token');
    expect(output('approved')).toBe('[1]');
  });
});
