import * as github from 'actions-util/octokit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpdateBranchApi } from './github-api.js';

vi.mock('actions-util/octokit');

interface OctokitMock {
  graphql: ReturnType<typeof vi.fn>;
  rest: {
    pulls: { get: ReturnType<typeof vi.fn>; updateBranch: ReturnType<typeof vi.fn> };
    repos: { compareCommitsWithBasehead: ReturnType<typeof vi.fn> };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    graphql: vi.fn(),
    rest: {
      pulls: { get: vi.fn(), updateBranch: vi.fn() },
      repos: { compareCommitsWithBasehead: vi.fn() },
    },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
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
    function node(number: number, overrides: Record<string, unknown> = {}): unknown {
      return {
        autoMergeRequest: null,
        headRefOid: `sha-${number}`,
        isDraft: false,
        labels: { nodes: [] },
        mergeStateStatus: 'CLEAN',
        number,
        ...overrides,
      };
    }

    function page(nodes: unknown[], endCursor: string | null = null): unknown {
      return { repository: { pullRequests: { nodes, pageInfo: { endCursor, hasNextPage: endCursor !== null } } } };
    }

    it('queries open pull requests oldest first at the largest page size', async () => {
      octokit.graphql.mockResolvedValue(page([]));

      await createUpdateBranchApi('token').listOpenPullRequests(repository);

      expect(octokit.graphql).toHaveBeenCalledTimes(1);
      const [query, variables] = octokit.graphql.mock.calls[0] as [string, Record<string, unknown>];
      expect(query).toContain('states: OPEN');
      expect(query).toContain('orderBy: { field: CREATED_AT, direction: ASC }');
      expect(variables).toEqual({ after: null, first: 100, owner: 'owner', repo: 'repo' });
    });

    it('follows the cursor across pages and reduces each node', async () => {
      octokit.graphql.mockResolvedValueOnce(page([node(1)], 'cursor-1')).mockResolvedValueOnce(
        page([
          null,
          node(2, {
            autoMergeRequest: { enabledAt: '2026-11-12T00:00:00Z' },
            isDraft: true,
            labels: { nodes: [{ name: 'dependencies' }, null, { name: 'bug' }] },
            mergeStateStatus: 'BEHIND',
          }),
        ]),
      );

      const pullRequests = await createUpdateBranchApi('token').listOpenPullRequests(repository);

      expect(octokit.graphql).toHaveBeenLastCalledWith(expect.any(String), {
        after: 'cursor-1',
        first: 100,
        owner: 'owner',
        repo: 'repo',
      });
      expect(pullRequests).toEqual([
        { autoMergeEnabled: false, draft: false, headSha: 'sha-1', labels: [], mergeStateStatus: 'CLEAN', number: 1 },
        {
          autoMergeEnabled: true,
          draft: true,
          headSha: 'sha-2',
          labels: ['dependencies', 'bug'],
          mergeStateStatus: 'BEHIND',
          number: 2,
        },
      ]);
    });

    it.each([
      ['no cursor', null],
      ['the cursor it was asked with', 'cursor-1'],
    ])('fails when a next page comes with %s', async (_label, endCursor) => {
      const stuck = { repository: { pullRequests: { nodes: [node(2)], pageInfo: { endCursor, hasNextPage: true } } } };
      octokit.graphql.mockResolvedValueOnce(page([node(1)], 'cursor-1')).mockResolvedValueOnce(stuck);

      await expect(createUpdateBranchApi('token').listOpenPullRequests(repository)).rejects.toThrow(
        'GitHub reported more open pull requests in owner/repo but no new cursor to fetch them with.',
      );
      expect(octokit.graphql).toHaveBeenCalledTimes(2);
    });

    it('fails when the repository cannot be read', async () => {
      octokit.graphql.mockResolvedValue({ repository: null });

      await expect(createUpdateBranchApi('token').listOpenPullRequests(repository)).rejects.toThrow(
        'Repository owner/repo was not found or the token cannot read it.',
      );
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
