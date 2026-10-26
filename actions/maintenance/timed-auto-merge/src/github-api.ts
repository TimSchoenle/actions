import { createOctokit } from 'actions-util/client';
import { fetchPullRequestCommits } from 'actions-util/commits';

import type { MergeMethod } from './merge-method.js';
import type { RepositoryCoordinates } from 'actions-util';
import type { PullRequestCommits } from 'actions-util/commits';

/** An open pull request reduced to the fields the decision needs. */
export interface OpenPullRequest {
  number: number;
  /** GraphQL node ID, which `enablePullRequestAutoMerge` addresses the pull request by. */
  nodeId: string;
  /** `https://github.com/owner/repo/pull/N`, which the commit query resolves. */
  url: string;
  headRef: string;
  /** The head commit at the time of listing. Everything after the listing is pinned to it. */
  headSha: string;
  /** Full name of the head repository, or `null` when the fork it came from has been deleted. */
  headRepoFullName: string | null;
  baseRepoFullName: string;
  /** ISO 8601 creation time. */
  createdAt: string;
  draft: boolean;
}

/** The GitHub operations this action performs, kept minimal so they can be faked in tests. */
export interface TimedAutoMergeApi {
  /** Lists every open pull request of the repository, across all pages. */
  listOpenPullRequests(repository: RepositoryCoordinates): Promise<OpenPullRequest[]>;
  /** Fetches every commit of a pull request, with all authors and the signature state of each. */
  fetchCommits(pullRequestUrl: string): Promise<PullRequestCommits>;
  /** Submits an approving review attached to `headSha`. */
  approve(repository: RepositoryCoordinates, number: number, headSha: string, body: string): Promise<void>;
  /** Enables auto-merge, which GitHub refuses if the head is no longer `expectedHeadOid`. */
  enableAutoMerge(nodeId: string, mergeMethod: MergeMethod, expectedHeadOid: string): Promise<void>;
}

/** GitHub's enum value for each merge method. */
const GRAPHQL_MERGE_METHOD: Record<MergeMethod, string> = {
  merge: 'MERGE',
  rebase: 'REBASE',
  squash: 'SQUASH',
};

/**
 * `expectedHeadOid` makes GitHub compare the head before it records the request, so a commit pushed
 * after this action verified the branch cannot be merged by it. The REST API has no such field.
 */
const ENABLE_AUTO_MERGE_MUTATION = `mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod, expectedHeadOid: $expectedHeadOid }) {
    pullRequest {
      number
    }
  }
}`;

/** Page size for the pull request listing; the maximum GitHub accepts. */
const PAGE_SIZE = 100;

/** The subset of a `pulls.list` item this adapter reads. */
interface PullRequestListItem {
  number: number;
  node_id: string;
  html_url: string;
  created_at: string;
  draft?: boolean;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { repo: { full_name: string } };
}

function toOpenPullRequest(item: PullRequestListItem): OpenPullRequest {
  return {
    baseRepoFullName: item.base.repo.full_name,
    createdAt: item.created_at,
    draft: item.draft === true,
    headRef: item.head.ref,
    headRepoFullName: item.head.repo?.full_name ?? null,
    headSha: item.head.sha,
    nodeId: item.node_id,
    number: item.number,
    url: item.html_url,
  };
}

/**
 * Binds {@link TimedAutoMergeApi} to the GitHub REST and GraphQL APIs.
 *
 * The client comes from `createOctokit`, which retries requests GitHub refuses for rate limiting on
 * both transports. The listing is paginated to completion; the workflow this action replaces used
 * `gh pr list`, which stops at 30 pull requests and silently ignored the rest.
 */
export function createTimedAutoMergeApi(token: string): TimedAutoMergeApi {
  const octokit = createOctokit(token);

  return {
    async approve({ owner, repo }, number, headSha, body) {
      await octokit.rest.pulls.createReview({
        body,
        commit_id: headSha,
        event: 'APPROVE',
        owner,
        pull_number: number,
        repo,
      });
    },

    async enableAutoMerge(nodeId, mergeMethod, expectedHeadOid) {
      await octokit.graphql(ENABLE_AUTO_MERGE_MUTATION, {
        expectedHeadOid,
        mergeMethod: GRAPHQL_MERGE_METHOD[mergeMethod],
        pullRequestId: nodeId,
      });
    },

    fetchCommits(pullRequestUrl) {
      return fetchPullRequestCommits(token, pullRequestUrl);
    },

    async listOpenPullRequests({ owner, repo }) {
      const items: PullRequestListItem[] = await octokit.paginate(octokit.rest.pulls.list, {
        owner,
        per_page: PAGE_SIZE,
        repo,
        sort: 'created',
        direction: 'asc',
        state: 'open',
      });

      return items.map(toOpenPullRequest);
    },
  };
}
