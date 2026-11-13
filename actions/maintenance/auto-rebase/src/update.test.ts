import * as core from 'actions-util/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasLabel, updateLabelledPullRequests } from './update.js';

import type { PullRequestDetail, PullRequestSummary, UpdateBranchApi } from './github-api.js';
import type { UpdateOptions } from './update.js';

vi.mock('actions-util/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const repository = { owner: 'owner', repo: 'repo' };

const options: UpdateOptions = {
  label: 'dependencies',
  limit: undefined,
  onlyAutoMerge: false,
  repository,
  skipDrafts: false,
};

function summary(
  number: number,
  labels: string[] = ['dependencies'],
  overrides: Partial<PullRequestSummary> = {},
): PullRequestSummary {
  return {
    autoMergeEnabled: false,
    draft: false,
    headSha: `sha-${number}`,
    labels,
    number,
    ...overrides,
  };
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
    mergeableState: 'unknown',
    number,
    state: 'open',
    ...overrides,
  };
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

interface FakeOptions {
  listed?: PullRequestSummary[];
  details?: Record<number, PullRequestDetail | undefined>;
  behind?: number;
}

function fakeApi({ behind = 3, details, listed }: FakeOptions = {}): UpdateBranchApi {
  const summaries = listed ?? [summary(1, ['dependencies']), summary(2, ['bug']), summary(3, ['dependencies', 'bug'])];

  return {
    commitsBehindBase: vi.fn(async () => behind),
    getPullRequest: vi.fn(async (_repository, number: number) =>
      details !== undefined && number in details ? details[number] : detail(number),
    ),
    listOpenPullRequests: vi.fn(async () => summaries),
    updateBranch: vi.fn(async () => {}),
  };
}

describe('hasLabel', () => {
  it.each([
    [['dependencies'], 'dependencies', true],
    [['Dependencies'], 'dependencies', true],
    [['bug', 'DEPENDENCIES'], 'Dependencies', true],
    [['dependencies-major'], 'dependencies', false],
    [[], 'dependencies', false],
  ])('%j carries %j: %s', (labels, label, expected) => {
    expect(hasLabel(labels, label)).toBe(expected);
  });
});

describe('updateLabelledPullRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates only the labelled pull requests, conditioned on their head', async () => {
    const api = fakeApi();

    const result = await updateLabelledPullRequests(api, options);

    expect(result).toEqual({ failed: [], matched: [1, 3], skipped: [], updated: [1, 3] });
    expect(api.updateBranch).toHaveBeenCalledTimes(2);
    expect(api.updateBranch).toHaveBeenCalledWith(repository, 1, 'sha-1');
    expect(api.updateBranch).toHaveBeenCalledWith(repository, 3, 'sha-3');
    expect(api.getPullRequest).not.toHaveBeenCalledWith(repository, 2);
  });

  it('matches the label case-insensitively', async () => {
    const api = fakeApi({ listed: [summary(1, ['Dependencies'])] });

    const result = await updateLabelledPullRequests(api, { ...options, label: 'DEPENDENCIES' });

    expect(result.updated).toEqual([1]);
  });

  it('touches nothing when no pull request carries the label', async () => {
    const api = fakeApi({ listed: [summary(2, ['bug'])] });

    const result = await updateLabelledPullRequests(api, options);

    expect(result).toEqual({ failed: [], matched: [], skipped: [], updated: [] });
    expect(api.getPullRequest).not.toHaveBeenCalled();
  });

  describe('re-read before updating', () => {
    it.each([
      ['closed', detail(1, { state: 'closed' }), 'not-open'],
      ['deleted', undefined, 'not-open'],
      ['unlabelled', detail(1, { labels: ['bug'] }), 'label-removed'],
      ['on a deleted fork', detail(1, { headRepoFullName: null }), 'head-repository-deleted'],
      ['on a fork maintainers cannot push to', detail(1, { headRepoFullName: 'fork/repo' }), 'fork-not-writable'],
    ] as const)('skips a pull request that is now %s', async (_name, current, reason) => {
      const api = fakeApi({ details: { 1: current }, listed: [summary(1, ['dependencies'])] });

      const result = await updateLabelledPullRequests(api, options);

      expect(result.skipped).toEqual([{ number: 1, reason }]);
      expect(api.updateBranch).not.toHaveBeenCalled();
    });

    it('updates a fork whose maintainers may push', async () => {
      const api = fakeApi({
        details: { 1: detail(1, { headRepoFullName: 'fork/repo', maintainerCanModify: true }) },
        listed: [summary(1, ['dependencies'])],
      });

      const result = await updateLabelledPullRequests(api, options);

      expect(result.updated).toEqual([1]);
    });

    // The head SHA the update is conditioned on comes from the re-read, not from the list.
    it('conditions the update on the head it just read', async () => {
      const api = fakeApi({
        details: { 1: detail(1, { headSha: 'fresh' }) },
        listed: [summary(1, ['dependencies'])],
      });

      await updateLabelledPullRequests(api, options);

      expect(api.commitsBehindBase).toHaveBeenCalledWith(repository, 'main', 'fresh');
      expect(api.updateBranch).toHaveBeenCalledWith(repository, 1, 'fresh');
    });
  });

  describe('drafts', () => {
    const draftOnly = { details: { 1: detail(1, { draft: true }) }, listed: [summary(1, ['dependencies'])] };

    it('updates a draft by default', async () => {
      const result = await updateLabelledPullRequests(fakeApi(draftOnly), options);

      expect(result.updated).toEqual([1]);
    });

    it('skips a draft when asked to', async () => {
      const result = await updateLabelledPullRequests(fakeApi(draftOnly), { ...options, skipDrafts: true });

      expect(result.skipped).toEqual([{ number: 1, reason: 'draft' }]);
    });

    it('skips a draft the listing reports without reading it', async () => {
      const api = fakeApi({ listed: [summary(1, ['dependencies'], { draft: true })] });

      const result = await updateLabelledPullRequests(api, { ...options, skipDrafts: true });

      expect(result.skipped).toEqual([{ number: 1, reason: 'draft' }]);
      expect(api.getPullRequest).not.toHaveBeenCalled();
    });
  });

  describe('up to date', () => {
    it('skips a head that already contains its base', async () => {
      const api = fakeApi({ behind: 0 });

      const result = await updateLabelledPullRequests(api, options);

      expect(result.skipped).toEqual([
        { number: 1, reason: 'up-to-date' },
        { number: 3, reason: 'up-to-date' },
      ]);
      expect(api.updateBranch).not.toHaveBeenCalled();
    });

    it('still sends the update when the comparison fails', async () => {
      const api = fakeApi({ listed: [summary(1, ['dependencies'])] });
      vi.mocked(api.commitsBehindBase).mockRejectedValue(new Error('No common ancestor'));

      const result = await updateLabelledPullRequests(api, options);

      expect(result.updated).toEqual([1]);
      expect(core.debug).toHaveBeenCalledWith('Could not compare #1 with its base: No common ancestor');
    });
  });

  describe('merge state from the re-read', () => {
    it('skips a pull request GitHub reports as conflicting without comparing or updating it', async () => {
      const api = fakeApi({
        details: { 1: detail(1, { mergeableState: 'dirty' }) },
        listed: [summary(1), summary(3)],
      });

      const result = await updateLabelledPullRequests(api, options);

      expect(result.skipped).toEqual([{ number: 1, reason: 'conflicting' }]);
      expect(result.updated).toEqual([3]);
      expect(api.commitsBehindBase).not.toHaveBeenCalledWith(repository, 'main', 'sha-1');
      expect(api.updateBranch).not.toHaveBeenCalledWith(repository, 1, expect.anything());
    });

    it('updates a behind pull request without comparing', async () => {
      const api = fakeApi({
        details: { 1: detail(1, { headSha: 'fresh', mergeableState: 'behind' }) },
        listed: [summary(1)],
      });

      const result = await updateLabelledPullRequests(api, options);

      expect(result.updated).toEqual([1]);
      expect(api.commitsBehindBase).not.toHaveBeenCalled();
      expect(api.updateBranch).toHaveBeenCalledWith(repository, 1, 'fresh');
    });

    it.each(['clean', 'blocked', 'unstable', 'has_hooks', 'unknown'])(
      'compares a pull request whose merge state is %s',
      async (mergeableState) => {
        const api = fakeApi({ details: { 1: detail(1, { mergeableState }) }, listed: [summary(1)] });

        const result = await updateLabelledPullRequests(api, options);

        expect(api.commitsBehindBase).toHaveBeenCalledWith(repository, 'main', 'sha-1');
        expect(result.updated).toEqual([1]);
      },
    );
  });

  describe('only_auto_merge', () => {
    const listed = [summary(1), summary(2, ['dependencies'], { autoMergeEnabled: true })];

    it('skips a pull request without auto-merge without reading it', async () => {
      const api = fakeApi({ listed });

      const result = await updateLabelledPullRequests(api, { ...options, onlyAutoMerge: true });

      expect(result.skipped).toEqual([{ number: 1, reason: 'auto-merge-off' }]);
      expect(result.updated).toEqual([2]);
      expect(api.getPullRequest).not.toHaveBeenCalledWith(repository, 1);
    });

    it('updates both when not set', async () => {
      const result = await updateLabelledPullRequests(fakeApi({ listed }), options);

      expect(result.updated).toEqual([1, 2]);
    });
  });

  describe('limit', () => {
    const listed = [summary(1), summary(2), summary(3)];

    it('updates only the oldest pull requests and skips the rest without reading them', async () => {
      const api = fakeApi({ listed });

      const result = await updateLabelledPullRequests(api, { ...options, limit: 1 });

      expect(result.updated).toEqual([1]);
      expect(result.skipped).toEqual([
        { number: 2, reason: 'limit-reached' },
        { number: 3, reason: 'limit-reached' },
      ]);
      expect(api.getPullRequest).toHaveBeenCalledTimes(1);
    });

    // The oldest pull request is the one that can merge next; updating a younger one would only
    // re-run its CI before the next merge puts it behind again.
    it('lets an up-to-date pull request hold its slot', async () => {
      const api = fakeApi({ behind: 0, listed });

      const result = await updateLabelledPullRequests(api, { ...options, limit: 1 });

      expect(result.skipped).toEqual([
        { number: 1, reason: 'up-to-date' },
        { number: 2, reason: 'limit-reached' },
        { number: 3, reason: 'limit-reached' },
      ]);
      expect(api.updateBranch).not.toHaveBeenCalled();
    });

    it('gives the slot of a skipped or rejected pull request to the next one', async () => {
      const api = fakeApi({
        details: { 1: detail(1, { state: 'closed' }) },
        listed: [summary(1), summary(2), summary(3), summary(4)],
      });
      vi.mocked(api.updateBranch).mockRejectedValueOnce(httpError(422, 'merge conflict'));

      const result = await updateLabelledPullRequests(api, { ...options, limit: 1 });

      expect(result.failed).toEqual([{ kind: 'rejected', message: 'merge conflict', number: 2 }]);
      expect(result.updated).toEqual([3]);
      expect(result.skipped).toEqual([
        { number: 1, reason: 'not-open' },
        { number: 4, reason: 'limit-reached' },
      ]);
    });

    it('counts only pull requests that pass the listing rules', async () => {
      const api = fakeApi({ listed: [summary(1, ['dependencies'], { draft: true }), summary(2)] });

      const result = await updateLabelledPullRequests(api, { ...options, limit: 1, skipDrafts: true });

      expect(result.updated).toEqual([2]);
    });

    it('gives the slot of a conflicting pull request to the next one', async () => {
      const api = fakeApi({
        details: { 1: detail(1, { mergeableState: 'dirty' }) },
        listed: [summary(1), summary(2)],
      });

      const result = await updateLabelledPullRequests(api, { ...options, limit: 1 });

      expect(result.skipped).toEqual([{ number: 1, reason: 'conflicting' }]);
      expect(result.updated).toEqual([2]);
    });
  });

  describe('failures', () => {
    // A head that moved between the re-read and the update, and a conflicting base, both answer 422.
    it('records a rejected update as a warning and carries on', async () => {
      const api = fakeApi();
      vi.mocked(api.updateBranch).mockRejectedValueOnce(
        httpError(422, 'expected head sha didn’t match current head ref.'),
      );

      const result = await updateLabelledPullRequests(api, options);

      expect(result.failed).toEqual([
        { kind: 'rejected', message: 'expected head sha didn’t match current head ref.', number: 1 },
      ]);
      expect(result.updated).toEqual([3]);
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('#1: GitHub rejected the update'));
      expect(core.error).not.toHaveBeenCalled();
    });

    it('records any other failure as an error and carries on', async () => {
      const api = fakeApi();
      vi.mocked(api.updateBranch).mockRejectedValueOnce(httpError(403, 'Resource not accessible by integration'));

      const result = await updateLabelledPullRequests(api, options);

      expect(result.failed).toEqual([{ kind: 'error', message: 'Resource not accessible by integration', number: 1 }]);
      expect(result.updated).toEqual([3]);
      expect(core.error).toHaveBeenCalledWith('#1: update failed: Resource not accessible by integration');
    });

    it('records a failing re-read as an error', async () => {
      const api = fakeApi({ listed: [summary(1, ['dependencies'])] });
      vi.mocked(api.getPullRequest).mockRejectedValue(httpError(500, 'Server Error'));

      const result = await updateLabelledPullRequests(api, options);

      expect(result.failed).toEqual([{ kind: 'error', message: 'Server Error', number: 1 }]);
    });

    it('propagates a failing list', async () => {
      const api = fakeApi();
      vi.mocked(api.listOpenPullRequests).mockRejectedValue(new Error('Bad credentials'));

      await expect(updateLabelledPullRequests(api, options)).rejects.toThrow('Bad credentials');
    });
  });
});
