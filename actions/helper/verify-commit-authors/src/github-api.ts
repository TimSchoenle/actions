import * as github from '@actions/github';
import { print } from 'graphql';

import { VerifyCommitsDocument } from './generated/graphql.js';
import { MAX_VERIFIABLE_COMMITS } from './verify.js';

import type { VerifyCommitsQuery } from './generated/graphql.js';
import type { CommitRecord } from './verify.js';

/** Maximum number of authors the query requests per commit; kept in sync with `verify-commits.graphql`. */
const MAX_AUTHORS_PER_COMMIT = 20;

type PullRequestResource = Extract<NonNullable<VerifyCommitsQuery['resource']>, { __typename?: 'PullRequest' }>;
type CommitNode = NonNullable<NonNullable<PullRequestResource['commits']['nodes']>[number]>;

/** The commits of a pull request, as far as they could be retrieved. */
export interface PullRequestCommits {
  /** Number of commits the pull request has, which may exceed the number of returned commits. */
  totalCount: number;
  /** The retrieved commits — at most {@link MAX_VERIFIABLE_COMMITS}. */
  commits: CommitRecord[];
}

/**
 * Maps a GraphQL commit node onto the domain model.
 *
 * Every field the decision depends on is required here. Incomplete data is rejected rather than
 * defaulted, because a missing author or signature must not be able to read as "nothing wrong".
 */
function toCommitRecord(node: CommitNode | null, index: number): CommitRecord {
  const commit = node?.commit;

  if (!commit?.oid) {
    throw new Error(`Incomplete commit data returned for commit #${index + 1}. Refusing to verify.`);
  }

  const authorNodes = commit.authors.nodes;

  if (!authorNodes) {
    throw new Error(`Incomplete author data returned for commit ${commit.oid}. Refusing to verify.`);
  }

  return {
    authorIds: authorNodes.map((author) => author?.user?.databaseId ?? null),
    authorsTruncated: commit.authors.totalCount > MAX_AUTHORS_PER_COMMIT,
    oid: commit.oid,
    signatureState: commit.signature?.state ?? null,
    signatureValid: commit.signature?.isValid === true,
  };
}

/**
 * Fetches the commits of a pull request via the GraphQL API.
 *
 * @throws if the URL does not resolve to a pull request, or if the returned commit data is
 * incomplete — both cases leave the action unable to make a trustworthy statement.
 */
export async function fetchPullRequestCommits(token: string, prUrl: string): Promise<PullRequestCommits> {
  const octokit = github.getOctokit(token);

  const response = await octokit.graphql<VerifyCommitsQuery>(print(VerifyCommitsDocument), { prUrl });
  const resource = response.resource;

  if (resource?.__typename !== 'PullRequest') {
    throw new Error('Could not find Pull Request data from URL');
  }

  const { nodes, totalCount } = resource.commits;

  if (!nodes) {
    throw new Error('Pull request returned no commit data. Refusing to verify.');
  }

  const commits = nodes.map((node, index) => toCommitRecord(node, index));
  const expectedCount = Math.min(totalCount, MAX_VERIFIABLE_COMMITS);

  if (commits.length !== expectedCount) {
    throw new Error(
      `Pull request reports ${totalCount} commit(s) but returned ${commits.length}. Refusing to verify incomplete data.`,
    );
  }

  return { commits, totalCount };
}
