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

/** The most recent update GitHub recorded for a branch: the commit it moved to and when. */
export interface BranchUpdate {
  /** The commit the branch pointed at after the update. */
  sha: string;
  /** ISO 8601 time GitHub recorded the update, set by GitHub rather than by whoever pushed. */
  timestamp: string;
}

/** The GitHub operations this action performs, kept minimal so they can be faked in tests. */
export interface TimedAutoMergeApi {
  /** Lists every open pull request of the repository, across all pages. */
  listOpenPullRequests(repository: RepositoryCoordinates): Promise<OpenPullRequest[]>;
  /** Fetches every commit of a pull request, with all authors and the signature state of each. */
  fetchCommits(pullRequestUrl: string): Promise<PullRequestCommits>;
  /**
   * Reads the most recent update of `branch` from the repository activity log, or `undefined` when
   * GitHub has none recorded.
   */
  latestBranchUpdate(repository: RepositoryCoordinates, branch: string): Promise<BranchUpdate | undefined>;
  /** Submits an approving review attached to `headSha`. */
  approve(repository: RepositoryCoordinates, number: number, headSha: string, body: string): Promise<void>;
  /** Enables auto-merge, which GitHub refuses if the head is no longer `expectedHeadOid`. */
  enableAutoMerge(nodeId: string, mergeMethod: MergeMethod, expectedHeadOid: string): Promise<void>;
  /** Reads the pull request's current head and GitHub's `mergeStateStatus` for it. */
  getMergeState(nodeId: string): Promise<MergeState>;
  /** Merges now, which GitHub refuses if the head is no longer `sha`. */
  merge(repository: RepositoryCoordinates, number: number, mergeMethod: MergeMethod, sha: string): Promise<void>;
}

/** A pull request's head and merge state, as the GraphQL `PullRequest` reports them. */
export interface MergeState {
  headOid: string;
  /** GitHub's `MergeStateStatus`, such as `CLEAN`, `BLOCKED` or `UNSTABLE`. */
  status: string;
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

const MERGE_STATE_QUERY = `query MergeState($pullRequestId: ID!) {
  node(id: $pullRequestId) {
    ... on PullRequest {
      headRefOid
      mergeStateStatus
    }
  }
}`;

interface MergeStateResponse {
  node: { headRefOid?: string; mergeStateStatus?: string } | null;
}

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
 * both transports. The listing is paginated to completion, so no open pull request is left out
 * however many there are; `gh pr list`, by comparison, stops at 30 by default.
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

    async getMergeState(nodeId) {
      const { node } = await octokit.graphql<MergeStateResponse>(MERGE_STATE_QUERY, { pullRequestId: nodeId });

      if (!node?.headRefOid || !node.mergeStateStatus) {
        throw new Error(`Pull request ${nodeId} has no head or merge state.`);
      }

      return { headOid: node.headRefOid, status: node.mergeStateStatus };
    },

    async merge({ owner, repo }, number, mergeMethod, sha) {
      await octokit.rest.pulls.merge({ merge_method: mergeMethod, owner, pull_number: number, repo, sha });
    },

    fetchCommits(pullRequestUrl) {
      return fetchPullRequestCommits(token, pullRequestUrl);
    },

    async latestBranchUpdate({ owner, repo }, branch) {
      // Newest first by default, so the first entry is the update that set the current head.
      const { data } = await octokit.rest.repos.listActivities({
        owner,
        per_page: 1,
        ref: `refs/heads/${branch}`,
        repo,
      });
      const latest = data[0];

      return latest ? { sha: latest.after, timestamp: latest.timestamp } : undefined;
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
