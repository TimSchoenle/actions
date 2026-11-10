import * as github from 'actions-util/octokit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTriggerApi } from './github-api.js';

vi.mock('actions-util/octokit');

interface OctokitMock {
  graphql: ReturnType<typeof vi.fn>;
  rest: {
    issues: { createComment: ReturnType<typeof vi.fn> };
    pulls: { get: ReturnType<typeof vi.fn> };
    users: { getAuthenticated: ReturnType<typeof vi.fn> };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    graphql: vi.fn(),
    rest: {
      issues: { createComment: vi.fn() },
      pulls: { get: vi.fn() },
      users: { getAuthenticated: vi.fn() },
    },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function apiPullRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
    draft: false,
    head: { repo: { full_name: 'owner/repo' }, sha: 'a'.repeat(40) },
    state: 'open',
    user: { login: 'alice', type: 'User' },
    ...overrides,
  };
}

const pullRequest = { number: 7, owner: 'owner', repo: 'repo' };

describe('createTriggerApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  describe('getTokenIdentity', () => {
    it('returns the login and account type', async () => {
      octokit.rest.users.getAuthenticated.mockResolvedValue({ data: { login: 'alice', type: 'User' } });

      await expect(createTriggerApi('token').getTokenIdentity()).resolves.toEqual({ login: 'alice', type: 'User' });
    });

    it('returns undefined when GET /user answers 403', async () => {
      octokit.rest.users.getAuthenticated.mockRejectedValue(httpError(403));

      await expect(createTriggerApi('token').getTokenIdentity()).resolves.toBeUndefined();
    });

    it('reports a rejected token as expired, revoked or malformed rather than as an app token', async () => {
      const rejection = httpError(401);
      octokit.rest.users.getAuthenticated.mockRejectedValue(rejection);

      const error: unknown = await createTriggerApi('token')
        .getTokenIdentity()
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('expired, revoked or malformed');
      expect((error as Error).cause).toBe(rejection);
    });

    it('propagates any other failure', async () => {
      octokit.rest.users.getAuthenticated.mockRejectedValue(httpError(502));

      await expect(createTriggerApi('token').getTokenIdentity()).rejects.toThrow('HTTP 502');
    });
  });

  describe('getPullRequest', () => {
    it('maps the fields the decision reads', async () => {
      octokit.rest.pulls.get.mockResolvedValue({
        data: apiPullRequest({
          draft: true,
          base: { ref: 'release', repo: { full_name: 'owner/repo' } },
          head: { repo: { full_name: 'fork/repo' }, sha: 'b'.repeat(40) },
          user: { login: 'renovate[bot]', type: 'Bot' },
        }),
      });

      await expect(createTriggerApi('token').getPullRequest(pullRequest)).resolves.toEqual({
        authorLogin: 'renovate[bot]',
        authorType: 'Bot',
        baseRef: 'release',
        baseRepoFullName: 'owner/repo',
        draft: true,
        headRepoFullName: 'fork/repo',
        headSha: 'b'.repeat(40),
        state: 'open',
      });
      expect(octokit.rest.pulls.get).toHaveBeenCalledWith({ owner: 'owner', pull_number: 7, repo: 'repo' });
    });

    it('reads a missing draft flag as not a draft', async () => {
      octokit.rest.pulls.get.mockResolvedValue({ data: apiPullRequest({ draft: undefined }) });

      await expect(createTriggerApi('token').getPullRequest(pullRequest)).resolves.toMatchObject({ draft: false });
    });

    it.each([
      ['author', { user: null }],
      ['head repository', { head: { repo: null } }],
      ['base repository', { base: { repo: null } }],
    ])('refuses a pull request without a %s', async (_field, overrides) => {
      octokit.rest.pulls.get.mockResolvedValue({ data: apiPullRequest(overrides) });

      await expect(createTriggerApi('token').getPullRequest(pullRequest)).rejects.toThrow(
        'Incomplete data for pull request #7',
      );
    });
  });

  describe('getReviewActivity', () => {
    it('reads comments and reviews, marking bots and deleted accounts', async () => {
      octokit.graphql.mockResolvedValue({
        repository: {
          pullRequest: {
            comments: {
              nodes: [
                {
                  author: { __typename: 'Bot', login: 'coderabbitai' },
                  body: 'reply',
                  createdAt: '2026-11-09T10:00:00Z',
                  id: 'IC_1',
                  updatedAt: '2026-11-09T10:05:00Z',
                  isMinimized: true,
                },
                {
                  author: null,
                  body: 'ghost',
                  createdAt: '2026-11-09T11:00:00Z',
                  id: 'IC_2',
                  isMinimized: false,
                  updatedAt: '2026-11-09T11:00:00Z',
                },
                null,
              ],
            },
            reviews: {
              nodes: [
                { author: { __typename: 'User', login: 'alice' }, body: 'lgtm', commit: { oid: 'a'.repeat(40) } },
                { author: { __typename: 'Bot', login: 'coderabbitai' }, body: '', commit: null },
              ],
            },
          },
        },
      });

      await expect(createTriggerApi('token').getReviewActivity(pullRequest)).resolves.toEqual({
        comments: [
          {
            authorIsBot: true,
            authorLogin: 'coderabbitai',
            body: 'reply',
            createdAt: '2026-11-09T10:00:00Z',
            isMinimized: true,
            nodeId: 'IC_1',
            updatedAt: '2026-11-09T10:05:00Z',
          },
          {
            authorIsBot: false,
            authorLogin: '',
            body: 'ghost',
            createdAt: '2026-11-09T11:00:00Z',
            isMinimized: false,
            nodeId: 'IC_2',
            updatedAt: '2026-11-09T11:00:00Z',
          },
        ],
        reviews: [
          { authorIsBot: false, authorLogin: 'alice', body: 'lgtm', commitSha: 'a'.repeat(40) },
          { authorIsBot: true, authorLogin: 'coderabbitai', body: '', commitSha: '' },
        ],
      });
      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining('comments(last: $pageSize)'), {
        number: 7,
        owner: 'owner',
        pageSize: 100,
        repo: 'repo',
      });
    });

    it.each([{ repository: null }, { repository: { pullRequest: null } }])(
      'fails when GitHub returns no pull request (%j)',
      async (response) => {
        octokit.graphql.mockResolvedValue(response);

        await expect(createTriggerApi('token').getReviewActivity(pullRequest)).rejects.toThrow(
          'GitHub returned no comments or reviews for pull request #7.',
        );
      },
    );
  });

  describe('minimizeComment', () => {
    it('collapses the comment as outdated', async () => {
      octokit.graphql.mockResolvedValue({ minimizeComment: { clientMutationId: null } });

      await createTriggerApi('token').minimizeComment('IC_1');

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining('classifier: OUTDATED'), {
        subjectId: 'IC_1',
      });
    });
  });

  describe('postComment', () => {
    it('creates an issue comment and returns its id and URL', async () => {
      octokit.rest.issues.createComment.mockResolvedValue({
        data: { html_url: 'https://github.com/owner/repo/pull/7#issuecomment-1', id: 1 },
      });

      await expect(createTriggerApi('token').postComment(pullRequest, '@coderabbitai review')).resolves.toEqual({
        id: 1,
        url: 'https://github.com/owner/repo/pull/7#issuecomment-1',
      });
      expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
        body: '@coderabbitai review',
        issue_number: 7,
        owner: 'owner',
        repo: 'repo',
      });
    });
  });
});
