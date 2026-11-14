import * as github from 'actions-util/octokit';
import { fetchPullRequestCommits } from 'actions-util/commits';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTimedAutoMergeApi } from './github-api.js';

vi.mock('actions-util/octokit');
vi.mock('actions-util/commits', () => ({ fetchPullRequestCommits: vi.fn() }));

interface OctokitMock {
  graphql: ReturnType<typeof vi.fn>;
  paginate: ReturnType<typeof vi.fn>;
  rest: {
    issues: { createComment: ReturnType<typeof vi.fn>; updateComment: ReturnType<typeof vi.fn> };
    pulls: { createReview: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; merge: ReturnType<typeof vi.fn> };
    repos: { compareCommitsWithBasehead: ReturnType<typeof vi.fn> };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    graphql: vi.fn(),
    paginate: vi.fn(),
    rest: {
      issues: { createComment: vi.fn(), updateComment: vi.fn() },
      pulls: { createReview: vi.fn(), list: vi.fn(), merge: vi.fn() },
      repos: { compareCommitsWithBasehead: vi.fn() },
    },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

const HEAD = 'a'.repeat(40);
const BASE = 'c'.repeat(40);
const repository = { owner: 'owner', repo: 'repo' };

function listItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    auto_merge: null,
    base: { ref: 'main', repo: { full_name: 'owner/repo' }, sha: BASE },
    created_at: '2026-10-20T08:00:00Z',
    draft: false,
    head: { ref: 'release-please--branches--main', repo: { full_name: 'owner/repo' }, sha: HEAD },
    html_url: 'https://github.com/owner/repo/pull/7',
    node_id: 'PR_kwDO',
    number: 7,
    user: { id: 29_139_614, login: 'renovate[bot]' },
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
          authorId: 29_139_614,
          baseRef: 'main',
          baseSha: BASE,
          baseRepoFullName: 'owner/repo',
          createdAt: '2026-10-20T08:00:00Z',
          draft: false,
          headRef: 'release-please--branches--main',
          headRepoFullName: 'owner/repo',
          headSha: HEAD,
          nodeId: 'PR_kwDO',
          number: 7,
          url: 'https://github.com/owner/repo/pull/7',
          autoMergeEnabled: false,
        },
      ]);
    });

    it('reads auto-merge as on when the listing carries an auto_merge object', async () => {
      octokit.paginate.mockResolvedValue([listItem({ auto_merge: { merge_method: 'squash' } })]);

      const [pullRequest] = await createTimedAutoMergeApi('token').listOpenPullRequests(repository);

      expect(pullRequest.autoMergeEnabled).toBe(true);
    });

    it('reads a deleted fork as a null head repository and a missing draft flag as false', async () => {
      octokit.paginate.mockResolvedValue([listItem({ draft: undefined, head: { ref: 'x', repo: null, sha: HEAD } })]);

      const [pullRequest] = await createTimedAutoMergeApi('token').listOpenPullRequests(repository);

      expect(pullRequest.headRepoFullName).toBeNull();
      expect(pullRequest.draft).toBe(false);
    });

    it('reads a deleted author as a null author ID', async () => {
      octokit.paginate.mockResolvedValue([listItem({ user: null })]);

      const [pullRequest] = await createTimedAutoMergeApi('token').listOpenPullRequests(repository);

      expect(pullRequest.authorId).toBeNull();
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
      autoMergeEnabled: false,
      headOid: HEAD,
      status: 'CLEAN',
      viewerApprovedOid: null,
    });
    expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining('mergeStateStatus'), {
      pullRequestId: 'PR_kwDO',
    });
  });

  it('reads auto-merge and the commit this identity last approved', async () => {
    octokit.graphql.mockResolvedValue({
      node: {
        autoMergeRequest: { enabledAt: '2026-10-20T08:00:00Z' },
        headRefOid: HEAD,
        mergeStateStatus: 'BLOCKED',
        viewerLatestReview: { commit: { oid: HEAD }, state: 'APPROVED' },
      },
    });

    await expect(createTimedAutoMergeApi('token').getMergeState('PR_kwDO')).resolves.toMatchObject({
      autoMergeEnabled: true,
      viewerApprovedOid: HEAD,
    });
  });

  it.each(['DISMISSED', 'COMMENTED', 'CHANGES_REQUESTED'])(
    'reads a latest review in state %s as no approval',
    async (state) => {
      octokit.graphql.mockResolvedValue({
        node: { headRefOid: HEAD, mergeStateStatus: 'BLOCKED', viewerLatestReview: { commit: { oid: HEAD }, state } },
      });

      await expect(createTimedAutoMergeApi('token').getMergeState('PR_kwDO')).resolves.toMatchObject({
        viewerApprovedOid: null,
      });
    },
  );

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
    vi.mocked(fetchPullRequestCommits).mockResolvedValue({
      commits: [],
      headOid: 'a'.repeat(40),
      headRepository: 'owner/repo',
      isCrossRepository: false,
      totalCount: 0,
    });

    await createTimedAutoMergeApi('ghs_token').fetchCommits('https://github.com/owner/repo/pull/7');

    expect(fetchPullRequestCommits).toHaveBeenCalledWith('ghs_token', 'https://github.com/owner/repo/pull/7');
  });

  describe('fetchDiff', () => {
    it('compares the merge base of the listed base with the head, one commit per page', async () => {
      octokit.rest.repos.compareCommitsWithBasehead.mockResolvedValue({
        data: {
          files: [
            { filename: 'a.txt', patch: '+x', sha: 'd'.repeat(40), status: 'modified' },
            { filename: 'b.bin', previous_filename: 'old.bin', sha: null, status: 'renamed' },
          ],
        },
      });

      const diff = await createTimedAutoMergeApi('token').fetchDiff(repository, BASE, HEAD);

      expect(octokit.rest.repos.compareCommitsWithBasehead).toHaveBeenCalledWith({
        basehead: `${BASE}...${HEAD}`,
        owner: 'owner',
        page: 1,
        per_page: 1,
        repo: 'repo',
      });
      expect(diff).toEqual({
        files: [
          { filename: 'a.txt', patch: '+x', previousFilename: null, sha: 'd'.repeat(40), status: 'modified' },
          { filename: 'b.bin', patch: null, previousFilename: 'old.bin', sha: null, status: 'renamed' },
        ],
        truncated: false,
      });
    });

    it("reports a list at GitHub's file limit as truncated", async () => {
      const files = Array.from({ length: 300 }, (_, index) => ({
        filename: `f${index}`,
        patch: '+x',
        sha: 'd'.repeat(40),
        status: 'added',
      }));
      octokit.rest.repos.compareCommitsWithBasehead.mockResolvedValue({ data: { files } });

      await expect(createTimedAutoMergeApi('token').fetchDiff(repository, BASE, HEAD)).resolves.toMatchObject({
        truncated: true,
      });
    });
  });

  describe('findOwnComment', () => {
    const page = (nodes: unknown[], endCursor: string | null) => ({
      node: { comments: { nodes, pageInfo: { endCursor, hasNextPage: endCursor !== null } } },
    });

    it('returns only a matching comment this identity wrote, across pages', async () => {
      octokit.graphql
        .mockResolvedValueOnce(
          page(
            [
              { body: 'marker', databaseId: 1, viewerDidAuthor: false },
              { body: 'other', databaseId: 2, viewerDidAuthor: true },
              null,
            ],
            'cursor-1',
          ),
        )
        .mockResolvedValueOnce(page([{ body: 'marker', databaseId: 3, viewerDidAuthor: true }], null));

      const comment = await createTimedAutoMergeApi('token').findOwnComment('PR_kwDO', (body) => body === 'marker');

      expect(comment).toEqual({ body: 'marker', id: 3 });
      expect(octokit.graphql).toHaveBeenLastCalledWith(expect.stringContaining('viewerDidAuthor'), {
        cursor: 'cursor-1',
        pullRequestId: 'PR_kwDO',
      });
    });

    it('returns undefined when no comment matches', async () => {
      octokit.graphql.mockResolvedValueOnce(page([], null));

      await expect(createTimedAutoMergeApi('token').findOwnComment('PR_kwDO', () => true)).resolves.toBeUndefined();
    });

    it('fails when the node is not a pull request', async () => {
      octokit.graphql.mockResolvedValueOnce({ node: null });

      await expect(createTimedAutoMergeApi('token').findOwnComment('PR_kwDO', () => true)).rejects.toThrow(
        /no comment list/,
      );
    });
  });

  it('creates and updates comments through the issues API', async () => {
    const api = createTimedAutoMergeApi('token');

    await api.createComment(repository, 7, 'hello');
    await api.updateComment(repository, 55, 'again');

    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: 'hello',
      issue_number: 7,
      owner: 'owner',
      repo: 'repo',
    });
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      body: 'again',
      comment_id: 55,
      owner: 'owner',
      repo: 'repo',
    });
  });
});
