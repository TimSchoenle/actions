import { describe, expect, it, vi } from 'vitest';

import { parseCommand, parseLogins, skipReasonFor, triggerReview } from './trigger.js';

import type { ReviewActivity } from './activity.js';
import type { PullRequestInfo, TokenIdentity, TriggerApi } from './github-api.js';
import type { TriggerOptions } from './trigger.js';

const openPullRequest: PullRequestInfo = {
  authorLogin: 'alice',
  authorType: 'User',
  baseRef: 'main',
  baseRepoFullName: 'owner/repo',
  draft: false,
  headRepoFullName: 'owner/repo',
  headSha: 'a'.repeat(40),
  state: 'open',
};

const options: TriggerOptions = {
  baseBranch: 'main',
  collapseOutdated: true,
  command: 'review',
  pullRequest: { number: 7, owner: 'owner', repo: 'repo' },
  rejectForks: true,
  skipAuthors: new Set(),
  skipBots: true,
  skipDrafts: true,
  skipDuplicates: true,
};

const BODY = `@coderabbitai review\n\n<!-- trigger-coderabbit-review head=${'a'.repeat(40)} -->`;
const NO_ACTIVITY: ReviewActivity = { comments: [], reviews: [] };

function fakeApi(
  pullRequest: PullRequestInfo = openPullRequest,
  // `null` stands for "GET /user refused the token"; `undefined` would fall back to the default.
  identity: TokenIdentity | null = { login: 'owner-user', type: 'User' },
  activity: ReviewActivity = NO_ACTIVITY,
): TriggerApi {
  return {
    getPullRequest: vi.fn(async () => pullRequest),
    getReviewActivity: vi.fn(async () => activity),
    getTokenIdentity: vi.fn(async () => identity ?? undefined),
    minimizeComment: vi.fn(async () => undefined),
    postComment: vi.fn(async () => ({ id: 1, url: 'https://github.com/owner/repo/pull/7#issuecomment-1' })),
  };
}

/** A marked request of `owner-user` for `head`, and CodeRabbit's reply to it. */
function requestWithReply(head: string, summary: string): ReviewActivity {
  return {
    comments: [
      {
        authorIsBot: false,
        authorLogin: 'owner-user',
        body: `@coderabbitai review\n\n<!-- trigger-coderabbit-review head=${head} -->`,
        createdAt: '2026-11-09T10:00:00Z',
        updatedAt: '2026-11-09T10:00:00Z',
        isMinimized: false,
        nodeId: 'IC_request',
      },
      {
        authorIsBot: true,
        authorLogin: 'coderabbitai',
        body: `<!-- CodeRabbit review command invocation: v2:abc -->\n<summary>${summary}</summary>`,
        createdAt: '2026-11-09T10:00:10Z',
        updatedAt: '2026-11-09T10:00:10Z',
        isMinimized: false,
        nodeId: 'IC_reply',
      },
    ],
    reviews: [],
  };
}

describe('parseCommand', () => {
  it.each(['review', 'full review', '  review  '])('accepts %j', (value) => {
    expect(parseCommand(value)).toBe(value.trim());
  });

  it.each(['', 'Review', 'resume', 'review; @coderabbitai pause'])('rejects %j', (value) => {
    expect(() => parseCommand(value)).toThrow('Invalid command');
  });
});

describe('parseLogins', () => {
  it('splits on commas and newlines, trims, lower-cases and drops blanks', () => {
    expect(parseLogins(' Renovate[bot] ,\nalice\n\n, ,Bob')).toEqual(new Set(['renovate[bot]', 'alice', 'bob']));
  });

  it('returns an empty set for an empty input', () => {
    expect(parseLogins('')).toEqual(new Set());
  });
});

describe('skipReasonFor', () => {
  it('skips a pull request into another base branch', () => {
    expect(skipReasonFor({ ...openPullRequest, baseRef: 'release' }, options)).toBe('other-base');
  });

  it('accepts any base branch when none is required', () => {
    expect(skipReasonFor({ ...openPullRequest, baseRef: 'release' }, { ...options, baseBranch: '' })).toBeUndefined();
  });

  it('skips a pull request whose head moved after the review was asked for', () => {
    expect(skipReasonFor(openPullRequest, { ...options, expectedHeadSha: 'b'.repeat(40) })).toBe('outdated');
  });

  it('accepts a pull request still on the head the review was asked for', () => {
    expect(skipReasonFor(openPullRequest, { ...options, expectedHeadSha: 'a'.repeat(40) })).toBeUndefined();
  });

  it('lets an open, ready, same-repository pull request by a user through', () => {
    expect(skipReasonFor(openPullRequest, options)).toBeUndefined();
  });

  it.each<[string, Partial<PullRequestInfo>, ReturnType<typeof skipReasonFor>]>([
    ['closed', { state: 'closed' }, 'closed'],
    ['draft', { draft: true }, 'draft'],
    ['fork', { headRepoFullName: 'someone/repo' }, 'fork'],
    ['bot', { authorLogin: 'renovate[bot]', authorType: 'Bot' }, 'bot-author'],
  ])('skips a %s pull request', (_name, overrides, reason) => {
    expect(skipReasonFor({ ...openPullRequest, ...overrides }, options)).toBe(reason);
  });

  it('reports closed before any other reason', () => {
    const everything: PullRequestInfo = {
      authorLogin: 'renovate[bot]',
      authorType: 'Bot',
      baseRef: 'release',
      baseRepoFullName: 'owner/repo',
      draft: true,
      headRepoFullName: 'someone/repo',
      headSha: 'b'.repeat(40),
      state: 'closed',
    };

    expect(skipReasonFor(everything, { ...options, expectedHeadSha: 'a'.repeat(40) })).toBe('closed');
  });

  it('compares repository names case-insensitively', () => {
    expect(skipReasonFor({ ...openPullRequest, headRepoFullName: 'Owner/Repo' }, options)).toBeUndefined();
  });

  it('skips a listed author case-insensitively', () => {
    expect(
      skipReasonFor({ ...openPullRequest, authorLogin: 'Alice' }, { ...options, skipAuthors: new Set(['alice']) }),
    ).toBe('skipped-author');
  });

  it('lets each rule be switched off', () => {
    const relaxed = { ...options, rejectForks: false, skipBots: false, skipDrafts: false };
    const pullRequest: PullRequestInfo = {
      ...openPullRequest,
      authorType: 'Bot',
      draft: true,
      headRepoFullName: 'someone/repo',
    };

    expect(skipReasonFor(pullRequest, relaxed)).toBeUndefined();
  });
});

describe('triggerReview', () => {
  it('posts the command and reports the comment', async () => {
    const api = fakeApi();

    await expect(triggerReview(api, options)).resolves.toEqual({
      actor: 'owner-user',
      collapse: { collapsed: 0, failures: [] },
      comment: { id: 1, url: 'https://github.com/owner/repo/pull/7#issuecomment-1' },
      triggered: true,
    });
    expect(api.postComment).toHaveBeenCalledWith(options.pullRequest, BODY);
  });

  it('skips a head commit CodeRabbit already reviewed', async () => {
    const api = fakeApi(openPullRequest, undefined, {
      comments: [],
      reviews: [
        {
          authorIsBot: true,
          authorLogin: 'coderabbitai',
          body: 'Actionable comments posted: 0',
          commitSha: 'a'.repeat(40),
        },
      ],
    });

    await expect(triggerReview(api, options)).resolves.toEqual({ skipReason: 'already-reviewed', triggered: false });
    expect(api.postComment).not.toHaveBeenCalled();
    expect(api.minimizeComment).not.toHaveBeenCalled();
  });

  it('skips a head commit with a pending request', async () => {
    const api = fakeApi(openPullRequest, undefined, requestWithReply('a'.repeat(40), 'Action performed'));

    await expect(triggerReview(api, options)).resolves.toEqual({ skipReason: 'already-requested', triggered: false });
    expect(api.postComment).not.toHaveBeenCalled();
  });

  it('posts a duplicate when skip_duplicates is off', async () => {
    const api = fakeApi(openPullRequest, undefined, requestWithReply('a'.repeat(40), 'Action performed'));

    await expect(triggerReview(api, { ...options, skipDuplicates: false })).resolves.toMatchObject({ triggered: true });
  });

  it('asks again after a request CodeRabbit did not complete, and collapses the old pair', async () => {
    const api = fakeApi(openPullRequest, undefined, requestWithReply('a'.repeat(40), 'Action not completed'));

    await expect(triggerReview(api, options)).resolves.toMatchObject({
      collapse: { collapsed: 2, failures: [] },
      triggered: true,
    });
    expect(api.minimizeComment).toHaveBeenCalledWith('IC_request');
    expect(api.minimizeComment).toHaveBeenCalledWith('IC_reply');
  });

  it('collapses the request and reply of an older head after posting', async () => {
    const api = fakeApi(openPullRequest, undefined, requestWithReply('b'.repeat(40), 'Action performed'));

    await triggerReview(api, options);

    expect(vi.mocked(api.postComment).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.minimizeComment).mock.invocationCallOrder[0] ?? 0,
    );
    expect(api.minimizeComment).toHaveBeenCalledTimes(2);
  });

  it('leaves comments expanded when collapse_outdated is off', async () => {
    const api = fakeApi(openPullRequest, undefined, requestWithReply('b'.repeat(40), 'Action performed'));

    await expect(triggerReview(api, { ...options, collapseOutdated: false })).resolves.toMatchObject({
      collapse: { collapsed: 0, failures: [] },
    });
    expect(api.minimizeComment).not.toHaveBeenCalled();
  });

  it('fails without posting when the comments cannot be read for skip_duplicates', async () => {
    const api = fakeApi();
    vi.mocked(api.getReviewActivity).mockRejectedValue(new Error('GraphQL error'));

    await expect(triggerReview(api, options)).rejects.toThrow('GraphQL error');
    expect(api.postComment).not.toHaveBeenCalled();
  });

  it('still posts when the comments cannot be read only for collapsing', async () => {
    const api = fakeApi();
    vi.mocked(api.getReviewActivity).mockRejectedValue(new Error('GraphQL error'));

    await expect(triggerReview(api, { ...options, skipDuplicates: false })).resolves.toMatchObject({
      collapse: { collapsed: 0, failures: ['could not read the comments: GraphQL error'] },
      triggered: true,
    });
    expect(api.postComment).toHaveBeenCalled();
  });

  it('reads no activity when both duplicate rules are off', async () => {
    const api = fakeApi();

    await triggerReview(api, { ...options, collapseOutdated: false, skipDuplicates: false });

    expect(api.getReviewActivity).not.toHaveBeenCalled();
  });

  it('reports a comment it cannot collapse and collapses the rest', async () => {
    const api = fakeApi(openPullRequest, undefined, requestWithReply('b'.repeat(40), 'Action performed'));
    vi.mocked(api.minimizeComment).mockRejectedValueOnce(new Error('Resource not accessible'));

    await expect(triggerReview(api, options)).resolves.toMatchObject({
      collapse: { collapsed: 1, failures: ['IC_request: Resource not accessible'] },
      triggered: true,
    });
  });

  it('posts a full review when asked to', async () => {
    const api = fakeApi();

    await triggerReview(api, { ...options, command: 'full review' });

    expect(api.postComment).toHaveBeenCalledWith(
      options.pullRequest,
      `@coderabbitai full review\n\n<!-- trigger-coderabbit-review head=${'a'.repeat(40)} -->`,
    );
  });

  it('returns the skip reason without posting', async () => {
    const api = fakeApi({ ...openPullRequest, draft: true });

    await expect(triggerReview(api, options)).resolves.toEqual({ skipReason: 'draft', triggered: false });
    expect(api.postComment).not.toHaveBeenCalled();
  });

  it('refuses an app or GITHUB_TOKEN before reading the pull request', async () => {
    const api = fakeApi(openPullRequest, null);

    await expect(triggerReview(api, options)).rejects.toThrow('a GitHub App or GITHUB_TOKEN (GET /user answered 403)');
    expect(api.getPullRequest).not.toHaveBeenCalled();
    expect(api.postComment).not.toHaveBeenCalled();
  });

  it('refuses a token whose account is not a user', async () => {
    const api = fakeApi(openPullRequest, { login: 'some-bot[bot]', type: 'Bot' });

    await expect(triggerReview(api, options)).rejects.toThrow('the Bot account "some-bot[bot]"');
    expect(api.postComment).not.toHaveBeenCalled();
  });

  it('refuses a bad token even when the pull request would be skipped', async () => {
    const api = fakeApi({ ...openPullRequest, state: 'closed' }, null);

    await expect(triggerReview(api, options)).rejects.toThrow('CodeRabbit ignores commands');
  });
});
