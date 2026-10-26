import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpdateBranchApi } from './github-api.js';

vi.mock('@actions/github');

interface OctokitMock {
  paginate: { iterator: ReturnType<typeof vi.fn> };
  rest: {
    pulls: { get: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; updateBranch: ReturnType<typeof vi.fn> };
    repos: { compareCommitsWithBasehead: ReturnType<typeof vi.fn> };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    paginate: { iterator: vi.fn() },
    rest: {
      pulls: { get: vi.fn(), list: vi.fn(), updateBranch: vi.fn() },
      repos: { compareCommitsWithBasehead: vi.fn() },
    },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

async function* pages(...pageData: unknown[][]): AsyncGenerator<{ data: unknown[] }> {
  for (const data of pageData) {
    yield { data };
  }
}

function listed(number: number, labels: string[] = []): unknown {
  return { labels: labels.map((name) => ({ name })), number };
}

function pullData(overrides: Record<string, unknown> = {}): unknown {
  return {
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
    draft: false,
    head: { repo: { full_name: 'owner/repo' }, sha: 'abc123' },
    labels: [{ name: 'dependencies' }],
    maintainer_can_modify: false,
    number: 7,
    state: 'open',
    ...overrides,
  };
}

const repository = { owner: 'owner', repo: 'repo' };

describe('createUpdateBranchApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  describe('listOpenPullRequests', () => {
    it('requests open pull requests at the largest page size', async () => {
      octokit.paginate.iterator.mockReturnValue(pages([]));

      await createUpdateBranchApi('token').listOpenPullRequests(repository);

      expect(octokit.paginate.iterator).toHaveBeenCalledWith(octokit.rest.pulls.list, {
        owner: 'owner',
        per_page: 100,
        repo: 'repo',
        state: 'open',
      });
    });

    it('collects every page, with label names', async () => {
      const first = Array.from({ length: 100 }, (_, index) => listed(index + 1));
      octokit.paginate.iterator.mockReturnValue(pages(first, [listed(101, ['dependencies', 'bug'])]));

      const pullRequests = await createUpdateBranchApi('token').listOpenPullRequests(repository);

      expect(pullRequests).toHaveLength(101);
      expect(pullRequests.at(-1)).toEqual({ labels: ['dependencies', 'bug'], number: 101 });
    });
  });

  describe('getPullRequest', () => {
    it('reduces the pull request to what the update decision reads', async () => {
      octokit.rest.pulls.get.mockResolvedValue({ data: pullData() });

      await expect(createUpdateBranchApi('token').getPullRequest(repository, 7)).resolves.toEqual({
        baseRef: 'main',
        baseRepoFullName: 'owner/repo',
        draft: false,
        headRepoFullName: 'owner/repo',
        headSha: 'abc123',
        labels: ['dependencies'],
        maintainerCanModify: false,
        number: 7,
        state: 'open',
      });
      expect(octokit.rest.pulls.get).toHaveBeenCalledWith({ owner: 'owner', pull_number: 7, repo: 'repo' });
    });

    it('reports a deleted head repository as null', async () => {
      octokit.rest.pulls.get.mockResolvedValue({ data: pullData({ head: { repo: null, sha: 'abc123' } }) });

      await expect(createUpdateBranchApi('token').getPullRequest(repository, 7)).resolves.toMatchObject({
        headRepoFullName: null,
      });
    });

    it('treats a missing draft flag as not a draft', async () => {
      octokit.rest.pulls.get.mockResolvedValue({ data: pullData({ draft: undefined }) });

      await expect(createUpdateBranchApi('token').getPullRequest(repository, 7)).resolves.toMatchObject({
        draft: false,
      });
    });

    it('returns undefined for a pull request that no longer exists', async () => {
      octokit.rest.pulls.get.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

      await expect(createUpdateBranchApi('token').getPullRequest(repository, 7)).resolves.toBeUndefined();
    });

    it('propagates every other failure', async () => {
      octokit.rest.pulls.get.mockRejectedValue(Object.assign(new Error('Bad credentials'), { status: 401 }));

      await expect(createUpdateBranchApi('token').getPullRequest(repository, 7)).rejects.toThrow('Bad credentials');
    });
  });

  describe('commitsBehindBase', () => {
    it('compares the base branch with the head commit, fetching one commit', async () => {
      octokit.rest.repos.compareCommitsWithBasehead.mockResolvedValue({ data: { ahead_by: 2, behind_by: 5 } });

      await expect(createUpdateBranchApi('token').commitsBehindBase(repository, 'main', 'abc123')).resolves.toBe(5);
      expect(octokit.rest.repos.compareCommitsWithBasehead).toHaveBeenCalledWith({
        basehead: 'main...abc123',
        owner: 'owner',
        page: 1,
        per_page: 1,
        repo: 'repo',
      });
    });
  });

  describe('updateBranch', () => {
    it('conditions the update on the expected head', async () => {
      octokit.rest.pulls.updateBranch.mockResolvedValue({ status: 202 });

      await createUpdateBranchApi('token').updateBranch(repository, 7, 'abc123');

      expect(octokit.rest.pulls.updateBranch).toHaveBeenCalledWith({
        expected_head_sha: 'abc123',
        owner: 'owner',
        pull_number: 7,
        repo: 'repo',
      });
    });
  });
});
