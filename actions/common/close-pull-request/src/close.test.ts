import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closePullRequestIfPresent,
  parsePullRequestId,
  parseRepository,
  PullRequestCloseError,
  PullRequestCommentError,
} from './close.js';

import type { PullRequestApi } from './close.js';

const repository = 'owner/repo';
const coordinates = { owner: 'owner', repo: 'repo' };

function fakeApi(existingPullRequests: number[] = [42]): PullRequestApi {
  return {
    closePullRequest: vi.fn(async () => undefined),
    commentOnPullRequest: vi.fn(async () => undefined),
    pullRequestExists: vi.fn(async (_repository, pullRequestNumber: number) =>
      existingPullRequests.includes(pullRequestNumber),
    ),
  };
}

describe('parseRepository', () => {
  it('splits owner and repository name', () => {
    expect(parseRepository('TimSchoenle/actions')).toEqual({ owner: 'TimSchoenle', repo: 'actions' });
  });

  it('accepts names with dots, dashes and underscores', () => {
    expect(parseRepository('some-org/my_repo.js')).toEqual({ owner: 'some-org', repo: 'my_repo.js' });
  });

  it.each(['', 'actions', 'owner/', '/repo', 'owner/repo/extra', 'owner repo', 'https://github.com/owner/repo'])(
    'rejects the malformed repository %j',
    (value) => {
      expect(() => parseRepository(value)).toThrow(`Invalid repository '${value}'`);
    },
  );
});

describe('parsePullRequestId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['0042', 42],
    ['999999', 999_999],
  ])('parses %j as %i', (value, expected) => {
    expect(parsePullRequestId(value)).toBe(expected);
  });

  it.each(['', '0', '-1', '1.5', '1e3', ' 42', '42 ', 'abc', '42abc', '+42', 'NaN', 'Infinity'])(
    'rejects the invalid pull request id %j',
    (value) => {
      expect(() => parsePullRequestId(value)).toThrow(
        `Invalid pull_request_id '${value}'. Expected a positive integer.`,
      );
    },
  );
});

describe('closePullRequestIfPresent', () => {
  let api: PullRequestApi;

  beforeEach(() => {
    api = fakeApi();
  });

  it('closes an existing pull request without commenting when no comment is given', async () => {
    const result = await closePullRequestIfPresent(api, { comment: '', pullRequestId: '42', repository });

    expect(result).toEqual({ closed: true, commented: false, pullRequestNumber: 42 });
    expect(api.closePullRequest).toHaveBeenCalledWith(coordinates, 42);
    expect(api.commentOnPullRequest).not.toHaveBeenCalled();
  });

  it('posts the comment before closing, so the reason appears above the close event', async () => {
    const order: string[] = [];
    const recording: PullRequestApi = {
      closePullRequest: vi.fn(async () => {
        order.push('close');
      }),
      commentOnPullRequest: vi.fn(async () => {
        order.push('comment');
      }),
      pullRequestExists: vi.fn(async () => true),
    };

    const result = await closePullRequestIfPresent(recording, {
      comment: 'Superseded by #43',
      pullRequestId: '42',
      repository,
    });

    expect(result).toEqual({ closed: true, commented: true, pullRequestNumber: 42 });
    expect(order).toEqual(['comment', 'close']);
    expect(recording.commentOnPullRequest).toHaveBeenCalledWith(coordinates, 42, 'Superseded by #43');
  });

  it('reports a pull request that does not exist as not closed, without calling the API further', async () => {
    const result = await closePullRequestIfPresent(api, { comment: 'ignored', pullRequestId: '7', repository });

    expect(result).toEqual({ closed: false, commented: false, pullRequestNumber: 7 });
    expect(api.commentOnPullRequest).not.toHaveBeenCalled();
    expect(api.closePullRequest).not.toHaveBeenCalled();
  });

  // An existing pull request that cannot be closed must never look like one that was already gone:
  // the caller would go on to delete the branch of a pull request that is still open.
  it('wraps a close failure in a PullRequestCloseError naming the pull request', async () => {
    const failing: PullRequestApi = {
      ...fakeApi(),
      closePullRequest: vi.fn(async () => {
        throw new Error('Resource not accessible by integration');
      }),
    };

    const request = { comment: '', pullRequestId: '42', repository };

    await expect(closePullRequestIfPresent(failing, request)).rejects.toThrow(PullRequestCloseError);
    await expect(closePullRequestIfPresent(failing, request)).rejects.toThrow(
      'Failed to close PR #42 in owner/repo: Resource not accessible by integration',
    );
  });

  it('wraps a comment failure in a PullRequestCommentError and does not close the pull request', async () => {
    const closePullRequest = vi.fn(async () => undefined);
    const failing: PullRequestApi = {
      ...fakeApi(),
      closePullRequest,
      commentOnPullRequest: vi.fn(async () => {
        throw new Error('Issues are disabled for this repo');
      }),
    };

    const request = { comment: 'bye', pullRequestId: '42', repository };

    await expect(closePullRequestIfPresent(failing, request)).rejects.toThrow(PullRequestCommentError);
    await expect(closePullRequestIfPresent(failing, request)).rejects.toThrow(
      'Failed to comment on PR #42 in owner/repo: Issues are disabled for this repo',
    );
    expect(closePullRequest).not.toHaveBeenCalled();
  });

  it('propagates a probe failure instead of reporting a missing pull request', async () => {
    const failing: PullRequestApi = {
      ...fakeApi(),
      pullRequestExists: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
    };

    await expect(closePullRequestIfPresent(failing, { comment: '', pullRequestId: '42', repository })).rejects.toThrow(
      'Bad credentials',
    );
  });

  it('rejects a malformed repository before making any API call', async () => {
    await expect(
      closePullRequestIfPresent(api, { comment: '', pullRequestId: '42', repository: 'not-a-repo' }),
    ).rejects.toThrow("Invalid repository 'not-a-repo'");

    expect(api.pullRequestExists).not.toHaveBeenCalled();
  });

  it('rejects an invalid pull request id before making any API call', async () => {
    await expect(closePullRequestIfPresent(api, { comment: '', pullRequestId: 'abc', repository })).rejects.toThrow(
      "Invalid pull_request_id 'abc'. Expected a positive integer.",
    );

    expect(api.pullRequestExists).not.toHaveBeenCalled();
  });
});
