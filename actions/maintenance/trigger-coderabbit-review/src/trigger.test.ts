import { describe, expect, it, vi } from 'vitest';

import { parseCommand, parseLogins, skipReasonFor, triggerReview } from './trigger.js';

import type { PullRequestInfo, TokenIdentity, TriggerApi } from './github-api.js';
import type { TriggerOptions } from './trigger.js';

const openPullRequest: PullRequestInfo = {
  authorLogin: 'alice',
  authorType: 'User',
  baseRepoFullName: 'owner/repo',
  draft: false,
  headRepoFullName: 'owner/repo',
  state: 'open',
};

const options: TriggerOptions = {
  command: 'review',
  pullRequest: { number: 7, owner: 'owner', repo: 'repo' },
  rejectForks: true,
  skipAuthors: new Set(),
  skipBots: true,
  skipDrafts: true,
};

function fakeApi(
  pullRequest: PullRequestInfo = openPullRequest,
  // `null` stands for "GET /user refused the token"; `undefined` would fall back to the default.
  identity: TokenIdentity | null = { login: 'owner-user', type: 'User' },
): TriggerApi {
  return {
    getPullRequest: vi.fn(async () => pullRequest),
    getTokenIdentity: vi.fn(async () => identity ?? undefined),
    postComment: vi.fn(async () => ({ id: 1, url: 'https://github.com/owner/repo/pull/7#issuecomment-1' })),
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
      baseRepoFullName: 'owner/repo',
      draft: true,
      headRepoFullName: 'someone/repo',
      state: 'closed',
    };

    expect(skipReasonFor(everything, options)).toBe('closed');
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
      comment: { id: 1, url: 'https://github.com/owner/repo/pull/7#issuecomment-1' },
      triggered: true,
    });
    expect(api.postComment).toHaveBeenCalledWith(options.pullRequest, '@coderabbitai review');
  });

  it('posts a full review when asked to', async () => {
    const api = fakeApi();

    await triggerReview(api, { ...options, command: 'full review' });

    expect(api.postComment).toHaveBeenCalledWith(options.pullRequest, '@coderabbitai full review');
  });

  it('returns the skip reason without posting', async () => {
    const api = fakeApi({ ...openPullRequest, draft: true });

    await expect(triggerReview(api, options)).resolves.toEqual({ skipReason: 'draft', triggered: false });
    expect(api.postComment).not.toHaveBeenCalled();
  });

  it('refuses an app or GITHUB_TOKEN before reading the pull request', async () => {
    const api = fakeApi(openPullRequest, null);

    await expect(triggerReview(api, options)).rejects.toThrow('a GitHub App or GITHUB_TOKEN');
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
