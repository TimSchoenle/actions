import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTriggerApi } from './github-api.js';

vi.mock('@actions/github');

interface OctokitMock {
  rest: {
    issues: { createComment: ReturnType<typeof vi.fn> };
    pulls: { get: ReturnType<typeof vi.fn> };
    users: { getAuthenticated: ReturnType<typeof vi.fn> };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
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
    base: { repo: { full_name: 'owner/repo' } },
    draft: false,
    head: { repo: { full_name: 'owner/repo' } },
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
          head: { repo: { full_name: 'fork/repo' } },
          user: { login: 'renovate[bot]', type: 'Bot' },
        }),
      });

      await expect(createTriggerApi('token').getPullRequest(pullRequest)).resolves.toEqual({
        authorLogin: 'renovate[bot]',
        authorType: 'Bot',
        baseRepoFullName: 'owner/repo',
        draft: true,
        headRepoFullName: 'fork/repo',
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
