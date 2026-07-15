import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchPullRequestCommits } from './github-commits.js';

vi.mock('@actions/github');

const PR_URL = 'https://github.com/owner/repo/pull/1';

const graphqlMock = vi.fn();

/** A single author node, as either query returns it. */
function author(id: number | null): unknown {
  return { user: id === null ? null : { databaseId: id } };
}

interface AuthorsFixture {
  ids?: (number | null)[];
  totalCount?: number;
  hasNextPage?: boolean;
  endCursor?: string | null;
  nodes?: unknown;
}

/** The author connection embedded in the pull-request query (carries totalCount). */
function authors({
  ids = [12345],
  totalCount,
  hasNextPage = false,
  endCursor = null,
  nodes,
}: AuthorsFixture = {}): unknown {
  return {
    nodes: nodes === undefined ? ids.map(author) : nodes,
    pageInfo: { endCursor, hasNextPage },
    totalCount: totalCount ?? ids.length,
  };
}

interface CommitFixture {
  oid?: string;
  authorsConnection?: unknown;
  signature?: { isValid: boolean; state: string } | null;
}

function commitNode({
  oid = 'abc1234',
  authorsConnection = authors(),
  signature = { isValid: true, state: 'VALID' },
}: CommitFixture = {}): unknown {
  return { commit: { authors: authorsConnection, oid, signature } };
}

interface CommitsPageFixture {
  nodes: unknown[] | null;
  totalCount?: number;
  hasNextPage?: boolean;
  endCursor?: string | null;
  nameWithOwner?: string;
}

/** A page of the `PullRequestCommits` query response. */
function commitsPage({
  nodes,
  totalCount,
  hasNextPage = false,
  endCursor = null,
  nameWithOwner = 'owner/repo',
}: CommitsPageFixture): unknown {
  return {
    resource: {
      __typename: 'PullRequest',
      commits: {
        nodes,
        pageInfo: { endCursor, hasNextPage },
        totalCount: totalCount ?? nodes?.length ?? 0,
      },
      repository: { nameWithOwner },
    },
  };
}

/** A page of the `CommitAuthors` follow-up query response. */
function authorsPage({ ids = [], hasNextPage = false, endCursor = null, nodes }: AuthorsFixture): unknown {
  return {
    repository: {
      object: {
        authors: { nodes: nodes === undefined ? ids.map(author) : nodes, pageInfo: { endCursor, hasNextPage } },
      },
    },
  };
}

/** Routes each query to its queued responses, so pagination can be driven without a network. */
function mockGraphql(commitPages: unknown[], authorPagesByOid: Record<string, unknown[]> = {}): void {
  const commitQueue = [...commitPages];
  const authorQueues = Object.fromEntries(Object.entries(authorPagesByOid).map(([oid, pages]) => [oid, [...pages]]));

  graphqlMock.mockImplementation(async (query: string, variables: Record<string, unknown>) => {
    if (query.includes('query PullRequestCommits')) {
      const page = commitQueue.shift();
      if (page === undefined) throw new Error('unexpected extra pull-request commits request');
      return page;
    }

    if (query.includes('query CommitAuthors')) {
      const page = authorQueues[variables.oid as string]?.shift();
      if (page === undefined) throw new Error(`unexpected author request for ${String(variables.oid)}`);
      return page;
    }

    throw new Error(`unexpected query: ${query}`);
  });
}

describe('fetchPullRequestCommits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(github.getOctokit).mockReturnValue({
      graphql: graphqlMock,
    } as unknown as ReturnType<typeof github.getOctokit>);
  });

  it('maps a single-page pull request onto the domain model', async () => {
    mockGraphql([
      commitsPage({ nodes: [commitNode({ authorsConnection: authors({ ids: [12345, 67890] }), oid: 'sha1' })] }),
    ]);

    await expect(fetchPullRequestCommits('token', PR_URL)).resolves.toEqual({
      commits: [
        {
          authorIds: [12345, 67890],
          oid: 'sha1',
          signatureState: 'VALID',
          signatureValid: true,
        },
      ],
      totalCount: 1,
    });
  });

  it('passes the pull request URL and a null starting cursor to the query', async () => {
    mockGraphql([commitsPage({ nodes: [commitNode()] })]);

    await fetchPullRequestCommits('token', PR_URL);

    expect(graphqlMock).toHaveBeenCalledWith(
      expect.stringContaining('query PullRequestCommits'),
      expect.objectContaining({ cursor: null, prUrl: PR_URL }),
    );
  });

  it('requests a full page of authors inline with the commits', async () => {
    mockGraphql([commitsPage({ nodes: [commitNode()] })]);

    await fetchPullRequestCommits('token', PR_URL);

    expect(graphqlMock.mock.calls[0][0]).toContain('authors(first: 100)');
  });

  it('maps an author without a linked GitHub account to null', async () => {
    mockGraphql([commitsPage({ nodes: [commitNode({ authorsConnection: authors({ ids: [null] }) })] })]);

    const { commits } = await fetchPullRequestCommits('token', PR_URL);

    expect(commits[0].authorIds).toEqual([null]);
  });

  it('maps a missing signature to an invalid, unsigned signature', async () => {
    mockGraphql([commitsPage({ nodes: [commitNode({ signature: null })] })]);

    const { commits } = await fetchPullRequestCommits('token', PR_URL);

    expect(commits[0]).toMatchObject({ signatureState: null, signatureValid: false });
  });

  it('walks every page of commits, forwarding the end cursor', async () => {
    mockGraphql([
      commitsPage({ endCursor: 'cursor-1', hasNextPage: true, nodes: [commitNode({ oid: 'sha1' })], totalCount: 2 }),
      commitsPage({ nodes: [commitNode({ oid: 'sha2' })], totalCount: 2 }),
    ]);

    const { commits, totalCount } = await fetchPullRequestCommits('token', PR_URL);

    expect(commits.map((commit) => commit.oid)).toEqual(['sha1', 'sha2']);
    expect(totalCount).toBe(2);
    expect(graphqlMock).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ cursor: 'cursor-1' }));
  });

  it('pages a commit whose authors span more than one page, addressing it by oid', async () => {
    mockGraphql(
      [
        commitsPage({
          nodes: [
            commitNode({
              authorsConnection: authors({ endCursor: 'a1', hasNextPage: true, ids: [12345], totalCount: 3 }),
              oid: 'sha1',
            }),
          ],
        }),
      ],
      {
        sha1: [authorsPage({ endCursor: 'a2', hasNextPage: true, ids: [67890] }), authorsPage({ ids: [111] })],
      },
    );

    const { commits } = await fetchPullRequestCommits('token', PR_URL);

    expect(commits[0].authorIds).toEqual([12345, 67890, 111]);
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.stringContaining('query CommitAuthors'),
      expect.objectContaining({ cursor: 'a1', oid: 'sha1', owner: 'owner', repo: 'repo' }),
    );
  });

  it.each([
    ['the URL resolves to an issue', { resource: { __typename: 'Issue' } }],
    ['the URL resolves to nothing', { resource: null }],
  ])('throws when %s', async (_name, response) => {
    mockGraphql([response]);

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow('Could not find Pull Request data from URL');
  });

  it('throws when the commit nodes are missing entirely', async () => {
    mockGraphql([commitsPage({ nodes: null, totalCount: 3 })]);

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow('returned no commit data');
  });

  it('throws on a null commit node instead of skipping it', async () => {
    mockGraphql([commitsPage({ nodes: [commitNode(), null], totalCount: 2 })]);

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow('Incomplete commit data');
  });

  it('throws when the author nodes are missing', async () => {
    mockGraphql([commitsPage({ nodes: [commitNode({ authorsConnection: authors({ nodes: null }) })] })]);

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow('Incomplete author data');
  });

  it('throws when fewer authors are returned than the commit reports', async () => {
    mockGraphql([
      commitsPage({
        nodes: [commitNode({ authorsConnection: authors({ ids: [12345], totalCount: 5 }), oid: 'sha1' })],
      }),
    ]);

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow(
      'Commit sha1 reports 5 author(s) but 1 were returned',
    );
  });

  it('throws when fewer commits are returned than the pull request reports', async () => {
    mockGraphql([commitsPage({ nodes: [commitNode()], totalCount: 5 })]);

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow(
      'Pull request reports 5 commit(s) but returned 1',
    );
  });

  it('propagates API errors', async () => {
    graphqlMock.mockRejectedValue(new Error('Bad credentials'));

    await expect(fetchPullRequestCommits('token', PR_URL)).rejects.toThrow('Bad credentials');
  });
});
