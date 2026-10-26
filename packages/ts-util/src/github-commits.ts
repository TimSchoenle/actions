import { createOctokit } from './github-client.js';
import { parseRepository } from './github.js';

import type { CommitRecord } from './commit-verification.js';

/**
 * Page size for every connection, and the ceiling GitHub enforces on a connection's `first`/`last`.
 * Larger connections are read across multiple pages via cursor pagination rather than truncated.
 */
const MAX_PAGE_SIZE = 100;

/**
 * Executes one GraphQL request, returning the raw response. The seam through which
 * {@link fetchPullRequestCommits} is driven, so pagination can be exercised in tests without a
 * network by routing on the query and variables.
 *
 * The response is `unknown`: it is untyped JSON, asserted to the expected shape once at each call
 * site — the single trust boundary between the wire and the typed model below.
 */
type GraphqlClient = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

/**
 * Pages through a pull request's commits, and each commit's authors, to completion.
 *
 * The commit connection is walked forward with `after` cursors, so a pull request of any size is read
 * in full rather than capped at one page. Each commit carries its first page of authors inline; a
 * commit with more authors than a page holds is completed by {@link collectAuthorIds} against the
 * commit object directly, keyed by its `oid`.
 *
 * Lives behind the `actions-util/commits` entry point rather than the package barrel: it pulls in
 * Octokit, which only the actions that talk to GitHub should bundle. See the note in `index.ts`.
 */
const PULL_REQUEST_COMMITS_QUERY = `query PullRequestCommits($prUrl: URI!, $cursor: String) {
  resource(url: $prUrl) {
    __typename
    ... on PullRequest {
      headRefOid
      repository {
        nameWithOwner
      }
      commits(first: ${MAX_PAGE_SIZE}, after: $cursor) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          commit {
            oid
            authors(first: ${MAX_PAGE_SIZE}) {
              totalCount
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                user {
                  databaseId
                }
              }
            }
            committer {
              user {
                databaseId
              }
            }
            signature {
              isValid
              state
              wasSignedByGitHub
              signer {
                databaseId
              }
            }
          }
        }
      }
    }
  }
}`;

/**
 * Fetches the remaining pages of a single commit's authors, addressed by its `oid`.
 *
 * A commit's author connection cannot be paged through the pull request query — that query's cursor
 * walks commits, not the authors nested under one. The commit object is therefore re-read directly so
 * its `authors` connection can be advanced with its own `after` cursor.
 */
const COMMIT_AUTHORS_QUERY = `query CommitAuthors($owner: String!, $repo: String!, $oid: GitObjectID!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    object(oid: $oid) {
      ... on Commit {
        authors(first: ${MAX_PAGE_SIZE}, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            user {
              databaseId
            }
          }
        }
      }
    }
  }
}`;

/** A cursor-paginated connection's page boundary. */
interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

/** One author of a commit, as the query returns it. */
interface AuthorNode {
  user: { databaseId: number | null } | null;
}

/** A page of a commit's authors. */
interface AuthorConnection {
  totalCount: number;
  pageInfo: PageInfo;
  nodes: (AuthorNode | null)[] | null;
}

/** A commit's signature, as the query returns it. */
interface SignatureFields {
  isValid: boolean;
  state: string | null;
  wasSignedByGitHub: boolean | null;
  signer: { databaseId: number | null } | null;
}

/** The commit fields the query selects. */
interface CommitFields {
  oid: string;
  authors: AuthorConnection;
  committer: { user: { databaseId: number | null } | null } | null;
  signature: SignatureFields | null;
}

interface CommitNode {
  commit: CommitFields | null;
}

/** A page of a pull request's commits. */
interface CommitConnection {
  totalCount: number;
  pageInfo: PageInfo;
  nodes: (CommitNode | null)[] | null;
}

/** The `resource(url:)` result, narrowed to the pull-request shape the query asks for. */
interface PullRequestCommitsResponse {
  resource: {
    __typename: string;
    headRefOid?: string | null;
    repository?: { nameWithOwner: string };
    commits?: CommitConnection;
  } | null;
}

/** The `repository.object(oid:)` result, narrowed to the commit's author connection. */
interface CommitAuthorsResponse {
  repository: {
    object: { authors?: AuthorConnection } | null;
  } | null;
}

/** The commits of a pull request. */
export interface PullRequestCommits {
  /**
   * SHA of the pull request head the commits were read at. Every page was read at this head and it is
   * one of {@link commits}, so a caller that acts on the pull request can bind the action to it.
   */
  headOid: string;
  /** Number of commits the pull request has. Equal to the length of {@link commits}. */
  totalCount: number;
  /** Every commit of the pull request. */
  commits: CommitRecord[];
}

/** The database ID of an author, or `null` for an author without a linked GitHub account. */
function mapAuthorId(author: AuthorNode | null): number | null {
  return author?.user?.databaseId ?? null;
}

/**
 * Collects the database IDs of every author of a commit, paging the author connection to completion.
 *
 * Rejecting a commit whose full author list cannot be retrieved — rather than proceeding on the first
 * page — is what keeps the author check trustworthy: a co-author hidden on an unread page must not be
 * able to read as "no such author".
 *
 * @throws if a page returns no author nodes, or if fewer authors are collected than the commit
 * reports.
 */
async function collectAuthorIds(
  graphql: GraphqlClient,
  nameWithOwner: string,
  commit: CommitFields,
): Promise<(number | null)[]> {
  const { authors } = commit;

  if (!authors.nodes) {
    throw new Error(`Incomplete author data returned for commit ${commit.oid}. Refusing to verify.`);
  }

  const authorIds = authors.nodes.map(mapAuthorId);
  let { pageInfo } = authors;

  if (pageInfo.hasNextPage) {
    const { owner, repo } = parseRepository(nameWithOwner);

    do {
      const response = (await graphql(COMMIT_AUTHORS_QUERY, {
        cursor: pageInfo.endCursor,
        oid: commit.oid,
        owner,
        repo,
      })) as CommitAuthorsResponse;

      const connection = response.repository?.object?.authors;

      if (!connection?.nodes) {
        throw new Error(`Incomplete author data returned for commit ${commit.oid}. Refusing to verify.`);
      }

      for (const author of connection.nodes) {
        authorIds.push(mapAuthorId(author));
      }
      pageInfo = connection.pageInfo;
    } while (pageInfo.hasNextPage);
  }

  if (authorIds.length !== authors.totalCount) {
    throw new Error(
      `Commit ${commit.oid} reports ${authors.totalCount} author(s) but ${authorIds.length} were returned. ` +
        'Refusing to verify incomplete data.',
    );
  }

  return authorIds;
}

/**
 * Maps a GraphQL commit node onto the domain model, resolving its full author list.
 *
 * Every field the decision depends on is required here. Incomplete data is rejected rather than
 * defaulted, because a missing author or signature must not be able to read as "nothing wrong".
 */
async function toCommitRecord(
  graphql: GraphqlClient,
  nameWithOwner: string,
  node: CommitNode | null,
  index: number,
): Promise<CommitRecord> {
  const commit = node?.commit;

  if (!commit?.oid) {
    throw new Error(`Incomplete commit data returned for commit #${index + 1}. Refusing to verify.`);
  }

  const { committer, signature } = commit;

  return {
    authorIds: await collectAuthorIds(graphql, nameWithOwner, commit),
    committerId: committer?.user?.databaseId ?? null,
    oid: commit.oid,
    signatureState: signature?.state ?? null,
    signatureValid: signature?.isValid === true,
    signedByGitHub: signature?.wasSignedByGitHub === true,
    signerId: signature?.signer?.databaseId ?? null,
  };
}

/**
 * Reads the head a page of commits was served at, requiring it to be the head every earlier page was
 * served at.
 *
 * @param reported the `headRefOid` of the current page.
 * @param previous the head of the earlier pages; `undefined` on the first page.
 * @throws if the page reports no head, or a head other than `previous`.
 */
function readHeadOid(reported: string | null | undefined, previous: string | undefined): string {
  if (!reported) {
    throw new Error('Pull request returned no head commit. Refusing to verify.');
  }
  if (previous !== undefined && previous !== reported) {
    throw new Error(
      `Pull request head moved from ${previous} to ${reported} while its commits were read. Refusing to verify.`,
    );
  }

  return reported;
}

/**
 * Walks every page of a pull request's commits.
 *
 * The head is read with every page. A push that lands while the pages are read moves it, and the pages
 * would then describe two different commit lists; the head is also required to be among the commits,
 * so the list read is the one ending at the head reported.
 *
 * @throws if the URL does not resolve to a pull request, if the head is missing, moves between pages or
 * is not among the commits, or if fewer commits are collected than the pull request reports — each
 * leaves the caller unable to make a trustworthy statement.
 */
async function collectPullRequestCommits(graphql: GraphqlClient, prUrl: string): Promise<PullRequestCommits> {
  const commits: CommitRecord[] = [];
  let cursor: string | null = null;
  let headOid: string | undefined;
  let totalCount: number;

  for (;;) {
    const response = (await graphql(PULL_REQUEST_COMMITS_QUERY, { cursor, prUrl })) as PullRequestCommitsResponse;
    const resource = response.resource;

    if (resource?.__typename !== 'PullRequest' || !resource.commits || !resource.repository) {
      throw new Error('Could not find Pull Request data from URL');
    }

    headOid = readHeadOid(resource.headRefOid, headOid);

    const { nameWithOwner } = resource.repository;
    const { nodes, pageInfo } = resource.commits;
    totalCount = resource.commits.totalCount;

    if (!nodes) {
      throw new Error('Pull request returned no commit data. Refusing to verify.');
    }

    for (const node of nodes) {
      commits.push(await toCommitRecord(graphql, nameWithOwner, node, commits.length));
    }

    if (!pageInfo.hasNextPage) {
      break;
    }
    cursor = pageInfo.endCursor;
  }

  if (commits.length !== totalCount) {
    throw new Error(
      `Pull request reports ${totalCount} commit(s) but returned ${commits.length}. Refusing to verify incomplete data.`,
    );
  }

  if (commits.length > 0 && !commits.some((commit) => commit.oid === headOid)) {
    throw new Error(`Pull request head ${headOid} is not among its commits. Refusing to verify.`);
  }

  return { commits, headOid, totalCount };
}

/**
 * Fetches every commit of a pull request, with the full author list, the committer and the signer of
 * each, via the GraphQL API.
 *
 * @throws if the URL does not resolve to a pull request, if the returned commit or author data is
 * incomplete, or if the head moves while the commits are read — every such case leaves the caller
 * unable to make a trustworthy statement.
 */
export async function fetchPullRequestCommits(token: string, prUrl: string): Promise<PullRequestCommits> {
  const octokit = createOctokit(token);
  const graphql: GraphqlClient = (query, variables) => octokit.graphql(query, variables);

  return collectPullRequestCommits(graphql, prUrl);
}
