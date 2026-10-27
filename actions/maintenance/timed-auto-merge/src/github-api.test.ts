import * as github from '@actions/github';
import { fetchPullRequestCommits } from 'actions-util/commits';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTimedAutoMergeApi } from './github-api.js';

vi.mock('@actions/github');
vi.mock('actions-util/commits', () => ({ fetchPullRequestCommits: vi.fn() }));

interface OctokitMock {
  graphql: ReturnType<typeof vi.fn>;
  paginate: ReturnType<typeof vi.fn>;
  rest: {
    pulls: { createReview: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; merge: ReturnType<typeof vi.fn> };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    graphql: vi.fn(),
    paginate: vi.fn(),
    rest: { pulls: { createReview: vi.fn(), list: vi.fn(), merge: vi.fn() } },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

const HEAD = 'a'.repeat(40);
const repository = { owner: 'owner', repo: 'repo' };

function listItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    base: { repo: { full_name: 'owner/repo' } },
    created_at: '2026-10-20T08:00:00Z',
    draft: false,
    head: { ref: 'release-please--branches--main', repo: { full_name: 'owner/repo' }, sha: HEAD },
    html_url: 'https://github.com/owner/repo/pull/7',
    node_id: 'PR_kwDO',
    number: 7,
    ...overrides,
  };
}

describe('createTimedAutoMergeApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  describe('listOpenPullRequests', () => {
    it('pages through every open pull request at the maximum page size', async () => {
      octokit.paginate.mockResolvedValue([listItem()]);

      await createTimedAutoMergeApi('token').listOpenPullRequests(repository);

      expect(octokit.paginate).toHaveBeenCalledWith(octokit.rest.pulls.list, {
        direction: 'asc',
        owner: 'owner',
        per_page: 100,
        repo: 'repo',
        sort: 'created',
        state: 'open',
      });
    });

    it('maps each item onto the fields the decision reads', async () => {
      octokit.paginate.mockResolvedValue([listItem()]);

      await expect(createTimedAutoMergeApi('token').listOpenPullRequests(repository)).resolves.toEqual([
        {
          baseRepoFullName: 'owner/repo',
          createdAt: '2026-10-20T08:00:00Z',
          draft: false,
          headRef: 'release-please--branches--main',
          headRepoFullName: 'owner/repo',
          headSha: HEAD,
          nodeId: 'PR_kwDO',
          number: 7,
          url: 'https://github.com/owner/repo/pull/7',
        },
      ]);
    });

    it('reads a deleted fork as a null head repository and a missing draft flag as false', async () => {
      octokit.paginate.mockResolvedValue([listItem({ draft: undefined, head: { ref: 'x', repo: null, sha: HEAD } })]);

      const [pullRequest] = await createTimedAutoMergeApi('token').listOpenPullRequests(repository);

      expect(pullRequest.headRepoFullName).toBeNull();
      expect(pullRequest.draft).toBe(false);
    });
  });

  it('approves with commit_id pinned to the verified head', async () => {
    await createTimedAutoMergeApi('token').approve(repository, 7, HEAD, 'ok');

    expect(octokit.rest.pulls.createReview).toHaveBeenCalledWith({
      body: 'ok',
      commit_id: HEAD,
      event: 'APPROVE',
      owner: 'owner',
      pull_number: 7,
      repo: 'repo',
    });
  });

  it.each([
    ['merge', 'MERGE'],
    ['rebase', 'REBASE'],
    ['squash', 'SQUASH'],
  ] as const)('enables %s auto-merge with expectedHeadOid set', async (method, graphqlMethod) => {
    await createTimedAutoMergeApi('token').enableAutoMerge('PR_kwDO', method, HEAD);

    expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining('expectedHeadOid: $expectedHeadOid'), {
      expectedHeadOid: HEAD,
      mergeMethod: graphqlMethod,
      pullRequestId: 'PR_kwDO',
    });
  });

  it('propagates a refused auto-merge', async () => {
    octokit.graphql.mockRejectedValue(new Error('Head sha did not match expected head oid'));

    await expect(createTimedAutoMergeApi('token').enableAutoMerge('PR_kwDO', 'squash', HEAD)).rejects.toThrow(
      'expected head oid',
    );
  });

  it('reads the head and merge state of the pull request', async () => {
    octokit.graphql.mockResolvedValue({ node: { headRefOid: HEAD, mergeStateStatus: 'CLEAN' } });

    await expect(createTimedAutoMergeApi('token').getMergeState('PR_kwDO')).resolves.toEqual({
      headOid: HEAD,
      status: 'CLEAN',
    });
    expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining('mergeStateStatus'), {
      pullRequestId: 'PR_kwDO',
    });
  });

  it('rejects a merge state response without a pull request', async () => {
    octokit.graphql.mockResolvedValue({ node: null });

    await expect(createTimedAutoMergeApi('token').getMergeState('PR_kwDO')).rejects.toThrow('no head or merge state');
  });

  it('merges with sha pinned to the verified head', async () => {
    await createTimedAutoMergeApi('token').merge(repository, 7, 'squash', HEAD);

    expect(octokit.rest.pulls.merge).toHaveBeenCalledWith({
      merge_method: 'squash',
      owner: 'owner',
      pull_number: 7,
      repo: 'repo',
      sha: HEAD,
    });
  });

  it('fetches commits through the shared paginated query', async () => {
    vi.mocked(fetchPullRequestCommits).mockResolvedValue({ commits: [], headOid: 'a'.repeat(40), totalCount: 0 });

    await createTimedAutoMergeApi('ghs_token').fetchCommits('https://github.com/owner/repo/pull/7');

    expect(fetchPullRequestCommits).toHaveBeenCalledWith('ghs_token', 'https://github.com/owner/repo/pull/7');
  });
});
