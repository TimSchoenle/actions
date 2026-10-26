import { describe, expect, it, vi } from 'vitest';

import { createBranchMatcher } from './branch-pattern.js';
import { processPullRequests } from './process.js';

import type { OpenPullRequest, TimedAutoMergeApi } from './github-api.js';
import type { TimedAutoMergeRequest } from './process.js';
import type { CommitRecord } from 'actions-util';

const TRUSTED = 1001;
const STRANGER = 6666;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const DAY = 86_400_000;
const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);

function pullRequest(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  const number = overrides.number ?? 7;

  return {
    baseRepoFullName: 'owner/repo',
    createdAt: new Date(NOW - 2 * DAY).toISOString(),
    draft: false,
    headRef: 'release-please--branches--main',
    headRepoFullName: 'owner/repo',
    headSha: HEAD,
    nodeId: `PR_node_${number}`,
    number,
    url: `https://github.com/owner/repo/pull/${number}`,
    ...overrides,
  };
}

function commit(oid: string, overrides: Partial<CommitRecord> = {}): CommitRecord {
  return { authorIds: [TRUSTED], oid, signatureState: 'VALID', signatureValid: true, ...overrides };
}

interface FakeApi extends TimedAutoMergeApi {
  listOpenPullRequests: ReturnType<typeof vi.fn<TimedAutoMergeApi['listOpenPullRequests']>>;
  fetchCommits: ReturnType<typeof vi.fn<TimedAutoMergeApi['fetchCommits']>>;
  approve: ReturnType<typeof vi.fn<TimedAutoMergeApi['approve']>>;
  enableAutoMerge: ReturnType<typeof vi.fn<TimedAutoMergeApi['enableAutoMerge']>>;
}

/** A fake whose commits default to two trusted, signed commits ending at {@link HEAD}. */
function fakeApi(pullRequests: OpenPullRequest[], commitsByUrl: Record<string, CommitRecord[]> = {}): FakeApi {
  return {
    approve: vi.fn<TimedAutoMergeApi['approve']>(async () => {}),
    enableAutoMerge: vi.fn<TimedAutoMergeApi['enableAutoMerge']>(async () => {}),
    fetchCommits: vi.fn<TimedAutoMergeApi['fetchCommits']>(async (url) => {
      const commits = commitsByUrl[url] ?? [commit(OLDER), commit(HEAD)];

      return { commits, totalCount: commits.length };
    }),
    listOpenPullRequests: vi.fn<TimedAutoMergeApi['listOpenPullRequests']>(async () => pullRequests),
  };
}

function request(overrides: Partial<TimedAutoMergeRequest> = {}): TimedAutoMergeRequest {
  return {
    approveMessage: 'ok',
    matcher: createBranchMatcher('release-please--branches--%', 'legacy'),
    mergeMethod: 'squash',
    minimumOpenMs: DAY,
    nowMs: NOW,
    repository: { owner: 'owner', repo: 'repo' },
    trustedAuthorIds: [TRUSTED],
    ...overrides,
  };
}

describe('processPullRequests', () => {
  it('approves at the listed head and enables auto-merge expecting that same head', async () => {
    const api = fakeApi([pullRequest()]);

    const report = await processPullRequests(api, request({ mergeMethod: 'rebase' }));

    expect(report).toEqual({
      openCount: 1,
      outcomes: [{ headRef: 'release-please--branches--main', headSha: HEAD, number: 7, status: 'approved' }],
    });
    expect(api.fetchCommits).toHaveBeenCalledWith('https://github.com/owner/repo/pull/7');
    expect(api.approve).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 7, HEAD, 'ok');
    expect(api.enableAutoMerge).toHaveBeenCalledWith('PR_node_7', 'rebase', HEAD);
    expect(api.approve.mock.invocationCallOrder[0]).toBeLessThan(api.enableAutoMerge.mock.invocationCallOrder[0]);
  });

  it('leaves pull requests on non-matching branches out of the report entirely', async () => {
    const api = fakeApi([pullRequest({ headRef: 'feature/x', number: 1 }), pullRequest({ number: 2 })]);

    const report = await processPullRequests(api, request());

    expect(report.openCount).toBe(2);
    expect(report.outcomes.map((outcome) => outcome.number)).toEqual([2]);
    expect(api.fetchCommits).toHaveBeenCalledTimes(1);
  });

  it('skips a pull request younger than the minimum without fetching its commits', async () => {
    const api = fakeApi([pullRequest({ createdAt: new Date(NOW - DAY + 1000).toISOString() })]);

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([expect.objectContaining({ detail: 'open for 23h, needs 24h', reason: 'too-young' })]);
    expect(api.fetchCommits).not.toHaveBeenCalled();
    expect(api.approve).not.toHaveBeenCalled();
  });

  it('accepts a pull request exactly at the minimum age', async () => {
    const api = fakeApi([pullRequest({ createdAt: new Date(NOW - DAY).toISOString() })]);

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes[0].status).toBe('approved');
  });

  it('reports a creation time in the future as zero age rather than a negative one', async () => {
    const api = fakeApi([pullRequest({ createdAt: new Date(NOW + DAY).toISOString() })]);

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([expect.objectContaining({ detail: 'open for 0m, needs 24h', reason: 'too-young' })]);
  });

  it('skips a pull request from a fork even when its branch name matches', async () => {
    const api = fakeApi([pullRequest({ headRepoFullName: 'attacker/repo' })]);

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([
      expect.objectContaining({ detail: 'head repository is attacker/repo', reason: 'fork', status: 'skipped' }),
    ]);
    expect(api.fetchCommits).not.toHaveBeenCalled();
  });

  it('skips a pull request whose fork has been deleted', async () => {
    const api = fakeApi([pullRequest({ headRepoFullName: null })]);

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([
      expect.objectContaining({ detail: 'head repository is a deleted fork', reason: 'fork' }),
    ]);
  });

  it('skips a draft', async () => {
    const api = fakeApi([pullRequest({ draft: true })]);

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([expect.objectContaining({ reason: 'draft', status: 'skipped' })]);
  });

  it('skips when the branch moved between listing and fetching commits', async () => {
    const pushed = 'c'.repeat(40);
    const api = fakeApi([pullRequest()], {
      'https://github.com/owner/repo/pull/7': [commit(OLDER), commit(HEAD), commit(pushed, { authorIds: [STRANGER] })],
    });

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([
      expect.objectContaining({
        detail: `commit list ends at ${pushed}, expected the listed head ${HEAD}`,
        reason: 'head-moved',
      }),
    ]);
    expect(api.approve).not.toHaveBeenCalled();
    expect(api.enableAutoMerge).not.toHaveBeenCalled();
  });

  it('skips when the commit list is empty', async () => {
    const api = fakeApi([pullRequest()], { 'https://github.com/owner/repo/pull/7': [] });

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([expect.objectContaining({ detail: expect.stringContaining('ends at nothing') })]);
  });

  it('skips when the head commit is not the last one in the list', async () => {
    // The head appears, but an unverified commit sorts after it.
    const api = fakeApi([pullRequest()], {
      'https://github.com/owner/repo/pull/7': [commit(HEAD), commit(OLDER)],
    });

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes[0]).toEqual(expect.objectContaining({ reason: 'head-moved' }));
  });

  it.each([
    ['an untrusted author', commit(OLDER, { authorIds: [STRANGER] }), /author\(s\) not accepted: 6666/],
    ['a trusted author beside an untrusted co-author', commit(OLDER, { authorIds: [TRUSTED, STRANGER] }), /6666/],
    ['an author without a GitHub account', commit(OLDER, { authorIds: [null] }), /not linked to a GitHub account/],
    [
      'an unsigned commit',
      commit(OLDER, { signatureState: 'UNSIGNED', signatureValid: false }),
      /signature is not valid \(state: UNSIGNED\)/,
    ],
    [
      'a signature GitHub could not verify',
      commit(OLDER, { signatureState: 'BAD_EMAIL', signatureValid: false }),
      /BAD_EMAIL/,
    ],
  ])('skips a pull request with %s and approves nothing', async (_name, failing, detail) => {
    const api = fakeApi([pullRequest()], { 'https://github.com/owner/repo/pull/7': [failing, commit(HEAD)] });

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([expect.objectContaining({ reason: 'commits-unverified', status: 'skipped' })]);
    expect(outcomes[0].status === 'skipped' && outcomes[0].detail).toMatch(detail);
    expect(api.approve).not.toHaveBeenCalled();
    expect(api.enableAutoMerge).not.toHaveBeenCalled();
  });

  it('records a failed approval and carries on with the next pull request', async () => {
    const api = fakeApi([pullRequest({ number: 1 }), pullRequest({ number: 2 })]);
    api.approve.mockRejectedValueOnce(new Error('Resource not accessible by integration'));

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([
      {
        headRef: 'release-please--branches--main',
        message: 'Resource not accessible by integration',
        number: 1,
        status: 'failed',
      },
      expect.objectContaining({ number: 2, status: 'approved' }),
    ]);
    expect(api.enableAutoMerge).toHaveBeenCalledTimes(1);
    expect(api.enableAutoMerge).toHaveBeenCalledWith('PR_node_2', 'squash', HEAD);
  });

  it('records a refused auto-merge, which is how a head that moved after approval surfaces', async () => {
    const api = fakeApi([pullRequest()]);
    api.enableAutoMerge.mockRejectedValueOnce(new Error('Head sha did not match expected head oid'));

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([
      expect.objectContaining({
        message: `Approved at ${HEAD}, but enabling auto-merge failed: Head sha did not match expected head oid`,
        status: 'failed',
      }),
    ]);
  });

  it('records a failed commit fetch without approving', async () => {
    const api = fakeApi([pullRequest()]);
    api.fetchCommits.mockRejectedValueOnce(new Error('Pull request reports 3 commit(s) but returned 2.'));

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes[0]).toEqual(expect.objectContaining({ status: 'failed' }));
    expect(api.approve).not.toHaveBeenCalled();
  });

  it('records an unreadable creation time as a failure, not as old enough', async () => {
    const api = fakeApi([pullRequest({ createdAt: 'yesterday' })]);

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([
      expect.objectContaining({ message: expect.stringContaining('"yesterday"'), status: 'failed' }),
    ]);
    expect(api.fetchCommits).not.toHaveBeenCalled();
  });

  it('records a non-Error rejection by its text', async () => {
    const api = fakeApi([pullRequest()]);
    api.fetchCommits.mockRejectedValueOnce('boom');

    const { outcomes } = await processPullRequests(api, request());

    expect(outcomes).toEqual([expect.objectContaining({ message: 'boom', status: 'failed' })]);
  });

  it('fails as a whole when the listing fails', async () => {
    const api = fakeApi([]);
    api.listOpenPullRequests.mockRejectedValueOnce(new Error('Bad credentials'));

    await expect(processPullRequests(api, request())).rejects.toThrow('Bad credentials');
  });

  it('fails as a whole when the branch pattern exhausts its budget', async () => {
    const api = fakeApi([pullRequest({ headRef: `${'a'.repeat(40)}!` })]);

    await expect(
      processPullRequests(api, request({ matcher: createBranchMatcher('(a+)+$', 'regex', 100) })),
    ).rejects.toThrow(/catastrophic backtracking/);
    expect(api.fetchCommits).not.toHaveBeenCalled();
  });

  it('reports nothing when no pull request is open', async () => {
    await expect(processPullRequests(fakeApi([]), request())).resolves.toEqual({ openCount: 0, outcomes: [] });
  });
});
