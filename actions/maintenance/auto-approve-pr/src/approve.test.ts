import { beforeEach, describe, expect, it, vi } from 'vitest';

import { autoApprove } from './approve.js';

import type { AutoApproveRequest } from './approve.js';
import type { AutoApproveApi, PullRequestInfo } from './github-api.js';
import type { CommitRecord } from 'actions-util';
import type { PullRequestCommits } from 'actions-util/commits';

function pullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    authorId: 12345,
    baseRepoFullName: 'owner/repo',
    changedFiles: 3,
    headRef: 'release-please--branches--main',
    headRepoFullName: 'owner/repo',
    ...overrides,
  };
}

function signedCommit(authorId = 12345): CommitRecord {
  return {
    authorIds: [authorId],
    oid: 'abc1234',
    signatureState: 'VALID',
    signatureValid: true,
  };
}

function commits(records: CommitRecord[] = [signedCommit()]): PullRequestCommits {
  return { commits: records, totalCount: records.length };
}

interface FakeApi extends AutoApproveApi {
  approveMock: ReturnType<typeof vi.fn>;
  fetchMock: ReturnType<typeof vi.fn>;
  getMock: ReturnType<typeof vi.fn>;
}

function fakeApi(info: PullRequestInfo = pullRequest(), prCommits: PullRequestCommits = commits()): FakeApi {
  const approveMock = vi.fn(async () => {});
  const fetchMock = vi.fn(async () => prCommits);
  const getMock = vi.fn(async () => info);

  return { approve: approveMock, approveMock, fetchCommits: fetchMock, fetchMock, getPullRequest: getMock, getMock };
}

const baseRequest: AutoApproveRequest = {
  approveMessage: 'Auto-approved by workflow.',
  branchPattern: '^release-please--branches--.*$',
  ignoreEmptyPrs: true,
  prUrl: 'https://github.com/owner/repo/pull/1',
  rejectForks: true,
  userIds: '12345, 67890',
};

describe('autoApprove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approves a pull request that passes every check', async () => {
    const api = fakeApi();

    await expect(autoApprove(api, baseRequest)).resolves.toEqual({ approved: true });

    expect(api.getMock).toHaveBeenCalledWith({ number: 1, owner: 'owner', repo: 'repo' });
    expect(api.approveMock).toHaveBeenCalledWith(
      { number: 1, owner: 'owner', repo: 'repo' },
      'Auto-approved by workflow.',
    );
  });

  it('skips and never fetches commits when the author is not accepted', async () => {
    const api = fakeApi(pullRequest({ authorId: 99999 }));

    await expect(autoApprove(api, baseRequest)).resolves.toEqual({
      approved: false,
      skipReason: 'author-not-accepted',
    });
    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(api.approveMock).not.toHaveBeenCalled();
  });

  it('skips when the branch does not match the pattern', async () => {
    const api = fakeApi(pullRequest({ headRef: 'feature/x' }));

    await expect(autoApprove(api, baseRequest)).resolves.toEqual({ approved: false, skipReason: 'branch-unverified' });
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('skips a fork when reject_forks is set', async () => {
    const api = fakeApi(pullRequest({ headRepoFullName: 'forker/repo' }));

    await expect(autoApprove(api, baseRequest)).resolves.toEqual({ approved: false, skipReason: 'branch-unverified' });
  });

  it('skips a pull request with no changed files when empty PRs are ignored', async () => {
    const api = fakeApi(pullRequest({ changedFiles: 0 }));

    await expect(autoApprove(api, baseRequest)).resolves.toEqual({ approved: false, skipReason: 'no-changes' });
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('approves a pull request with no changed files when empty PRs are allowed', async () => {
    const api = fakeApi(pullRequest({ changedFiles: 0 }));

    await expect(autoApprove(api, { ...baseRequest, ignoreEmptyPrs: false })).resolves.toEqual({ approved: true });
    expect(api.approveMock).toHaveBeenCalled();
  });

  it('skips when a commit fails author or signature verification', async () => {
    const api = fakeApi(pullRequest(), commits([{ ...signedCommit(), signatureValid: false }]));

    await expect(autoApprove(api, baseRequest)).resolves.toEqual({ approved: false, skipReason: 'commits-unverified' });
    expect(api.approveMock).not.toHaveBeenCalled();
  });

  it('throws for a malformed pull request URL, before any API call', async () => {
    const api = fakeApi();

    await expect(autoApprove(api, { ...baseRequest, prUrl: 'not-a-url' })).rejects.toThrow('Invalid pull request URL');
    expect(api.getMock).not.toHaveBeenCalled();
  });

  it('throws for malformed user_ids, before any API call', async () => {
    const api = fakeApi();

    await expect(autoApprove(api, { ...baseRequest, userIds: 'oops' })).rejects.toThrow("Invalid user ID 'oops'");
    expect(api.getMock).not.toHaveBeenCalled();
  });
});
