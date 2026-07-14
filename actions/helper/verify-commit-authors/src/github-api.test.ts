import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchPullRequestCommits } from './github-api.js';

vi.mock('@actions/github');

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

const PR_URL = 'https://github.com/owner/repo/pull/1';

const graphqlMock = vi.fn();

interface CommitFixture {
  oid?: string;
  authorIds?: (number | null)[];
  authorTotalCount?: number;
  authorNodes?: unknown;
  signature?: { isValid: boolean; state: string } | null;
}

function commitNode({
  oid = 'abc1234',
  authorIds = [12345],
  authorTotalCount,
  authorNodes,
  signature = { isValid: true, state: 'VALID' },
}: CommitFixture = {}): unknown {
  return {
    commit: {
      authors: {
        nodes:
          authorNodes === undefined
            ? authorIds.map((id) => ({ user: id === null ? null : { databaseId: id } }))
            : authorNodes,
        totalCount: authorTotalCount ?? authorIds.length,
      },
      oid,
      signature,
    },
  };
}

function mockResponse(nodes: unknown[], totalCount?: number): void {
  graphqlMock.mockResolvedValue({
    resource: {
      __typename: 'PullRequest',
      commits: { nodes, totalCount: totalCount ?? nodes.length },
    },
  } as DeepPartial<unknown>);
}

describe('fetchPullRequestCommits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(github.getOctokit).mockReturnValue({
      graphql: graphqlMock,
    } as unknown as ReturnType<typeof github.getOctokit>);
  });

  it('maps commits onto the domain model', async () => {
    mockResponse([commitNode({ authorIds: [12345, 67890], oid: 'sha1' })]);

    await expect(fetchPullRequestCommits('token', PR_URL)).resolves.toEqual({
      commits: [
        {
          authorIds: [12345, 67890],
          authorsTruncated: false,
          oid: 'sha1',
          signatureState: 'VALID',
          signatureValid: true,
        },
      ],
      totalCount: 1,
    });
  });

  it('passes the pull request URL to the query', async () => {
    mockResponse([commitNode()]);

    await fetchPullRequestCommits('token', PR_URL);

    expect(graphqlMock).toHaveBeenCalledWith(expect.stringContaining('query VerifyCommits'), { prUrl: PR_URL });
  });

  it('maps an author without a linked GitHub account to null', async () => {
    mockResponse([commitNode({ authorIds: [null] })]);

    const { commits } = await fetchPullRequestCommits('token', PR_URL);

    expect(commits[0].authorIds).toEqual([null]);
  });

  it('maps a missing signature to an invalid, unsigned signature', async () => {
    mockResponse([commitNode({ signature: null })]);

    const { commits } = await fetchPullRequestCommits('token', PR_URL);

    expect(commits[0]).toMatchObject({ signatureState: null, signatureValid: false });
  });

  // MAX_AUTHORS_PER_COMMIT must match the page size in verify-commits.graphql: a larger page would
  // make the truncation check miss authors it should have flagged.
  it('requests exactly as many authors as the truncation check assumes', async () => {
    mockResponse([commitNode()]);

    await fetchPullRequestCommits('token', PR_URL);

    expect(graphqlMock.mock.calls[0][0]).toContain('authors(first: 20)');
  });

  it('flags a commit whose author list exceeds the queried page size', async () => {
    mockResponse([commitNode({ authorIds: [12345], authorTotalCount: 21 })]);

    const { commits } = await fetchPullRequestCommits('token', PR_URL);

    expect(commits[0].authorsTruncated).toBe(true);
  });

  it('reports the total commit count of a pull request larger than one page', async () => {
    const nodes = Array.from({ length: 100 }, (_, index) => commitNode({ oid: `sha${index}` }));
    mockResponse(nodes, 250);

    const { commits, totalCount } = await fetchPullRequestCommits('token', PR_URL);

    expect(totalCount).toBe(250);
    expect(commits).toHaveLength(100);
  });

  it.each([
    ['the URL resolves to an issue', { resource: { __typename: 'Issue' } }],
    ['the URL resolves to nothing', { resource: null }],
  ])('throws when %s', async (_name, response) => {
    graphqlMock.mockResolvedValue(response);

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow('Could not find Pull Request data from URL');
  });

  it('throws when the commit nodes are missing entirely', async () => {
    graphqlMock.mockResolvedValue({
      resource: { __typename: 'PullRequest', commits: { nodes: null, totalCount: 3 } },
    });

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow('returned no commit data');
  });

  it('throws on a null commit node instead of skipping it', async () => {
    mockResponse([commitNode(), null]);

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow('Incomplete commit data');
  });

  it('throws when the author nodes are missing', async () => {
    mockResponse([commitNode({ authorNodes: null })]);

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow('Incomplete author data');
  });

  it('throws when fewer commits are returned than the pull request reports', async () => {
    mockResponse([commitNode()], 5);

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow(
      'Pull request reports 5 commit(s) but returned 1',
    );
  });

  it('propagates API errors', async () => {
    graphqlMock.mockRejectedValue(new Error('Bad credentials'));

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow('Bad credentials');
  });
});
