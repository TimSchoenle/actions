import * as github from '@actions/github';
import { fetchPullRequestCommits } from 'actions-util/commits';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutoApproveApi } from './github-api.js';

vi.mock('@actions/github');
vi.mock('actions-util/commits', () => ({ fetchPullRequestCommits: vi.fn() }));

interface OctokitMock {
  rest: {
    pulls: {
      get: ReturnType<typeof vi.fn>;
      createReview: ReturnType<typeof vi.fn>;
    };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    rest: { pulls: { createReview: vi.fn(), get: vi.fn() } },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

/** A pulls.get payload, with the parts the adapter reads overridable. */
function prData(overrides: Record<string, unknown> = {}): unknown {
  return {
    base: { repo: { full_name: 'owner/repo' } },
    changed_files: 4,
    head: { ref: 'feature/x', repo: { full_name: 'owner/repo' } },
    user: { id: 12345 },
    ...overrides,
  };
}

const coordinates = { number: 7, owner: 'owner', repo: 'repo' };

describe('createAutoApproveApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  describe('getPullRequest', () => {
    it('reads the fields the decision depends on', async () => {
      octokit.rest.pulls.get.mockResolvedValue({ data: prData() });

      await expect(createAutoApproveApi('token').getPullRequest(coordinates)).resolves.toEqual({
        authorId: 12345,
        baseRepoFullName: 'owner/repo',
        changedFiles: 4,
        headRef: 'feature/x',
        headRepoFullName: 'owner/repo',
      });
      expect(octokit.rest.pulls.get).toHaveBeenCalledWith({ owner: 'owner', pull_number: 7, repo: 'repo' });
    });

    it('reports the head repository of a fork', async () => {
      octokit.rest.pulls.get.mockResolvedValue({
        data: prData({ head: { ref: 'feature/x', repo: { full_name: 'forker/repo' } } }),
      });

      await expect(createAutoApproveApi('token').getPullRequest(coordinates)).resolves.toMatchObject({
        headRepoFullName: 'forker/repo',
      });
    });

    it('refuses to evaluate a pull request whose head repository is gone', async () => {
      octokit.rest.pulls.get.mockResolvedValue({ data: prData({ head: { ref: 'feature/x', repo: null } }) });

      await expect(createAutoApproveApi('token').getPullRequest(coordinates)).rejects.toThrow('Incomplete data');
    });

    it('refuses to evaluate a pull request with no author', async () => {
      octokit.rest.pulls.get.mockResolvedValue({ data: prData({ user: null }) });

      await expect(createAutoApproveApi('token').getPullRequest(coordinates)).rejects.toThrow('Incomplete data');
    });
  });

  describe('approve', () => {
    it('submits an approving review with the message body', async () => {
      octokit.rest.pulls.createReview.mockResolvedValue({});

      await createAutoApproveApi('token').approve(coordinates, 'Looks good');

      expect(octokit.rest.pulls.createReview).toHaveBeenCalledWith({
        body: 'Looks good',
        event: 'APPROVE',
        owner: 'owner',
        pull_number: 7,
        repo: 'repo',
      });
    });
  });

  describe('fetchCommits', () => {
    it('delegates to the shared pull-request commit fetch', async () => {
      vi.mocked(fetchPullRequestCommits).mockResolvedValue({ commits: [], totalCount: 0 });

      await createAutoApproveApi('token').fetchCommits('https://github.com/owner/repo/pull/7');

      expect(fetchPullRequestCommits).toHaveBeenCalledWith('token', 'https://github.com/owner/repo/pull/7');
    });
  });
});
