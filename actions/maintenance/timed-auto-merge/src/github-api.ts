import { createOctokit } from 'actions-util/client';
import { fetchPullRequestCommits } from 'actions-util/commits';

import type { MergeMethod } from './merge-method.js';
import type { DiffFile } from './soak.js';
import type { RepositoryCoordinates } from 'actions-util';
import type { PullRequestCommits } from 'actions-util/commits';

/** An open pull request reduced to the fields the decision needs. */
export interface OpenPullRequest {
  number: number;
  /** Database ID of the account that opened it, or `null` when that account was deleted. */
  authorId: number | null;
  /** Name of the branch it would merge into. */
  baseRef: string;
  /** The base commit GitHub recorded for the pull request, which the diff is compared from. */
  baseSha: string;
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
  /** Whether auto-merge was on at the time of listing. */
  autoMergeEnabled: boolean;
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
  /**
   * Reads the pull request's current head, GitHub's `mergeStateStatus` for it, whether auto-merge is on
   * and what this token's identity last approved.
   */
  getMergeState(nodeId: string): Promise<MergeState>;
  /** Merges now, which GitHub refuses if the head is no longer `sha`. */
  merge(repository: RepositoryCoordinates, number: number, mergeMethod: MergeMethod, sha: string): Promise<void>;
  /**
   * Reads the files changed between the merge base of `baseSha` and `headSha`, the pull request's
   * diff, pinned to both commits.
   */
  fetchDiff(repository: RepositoryCoordinates, baseSha: string, headSha: string): Promise<PullRequestDiff>;
  /** Finds the first comment on the pull request written by this token's identity that `matches`. */
  findOwnComment(nodeId: string, matches: (body: string) => boolean): Promise<OwnComment | undefined>;
  /** Comments on the pull request. */
  createComment(repository: RepositoryCoordinates, number: number, body: string): Promise<void>;
  /** Replaces the body of a comment. */
  updateComment(repository: RepositoryCoordinates, commentId: number, body: string): Promise<void>;
}

/** A pull request's changed files, and whether GitHub left any out. */
export interface PullRequestDiff {
  files: DiffFile[];
  /** GitHub lists at most {@link MAX_COMPARE_FILES} files; more were changed when this is `true`. */
  truncated: boolean;
}

/** A comment this token's identity wrote. */
export interface OwnComment {
  /** REST ID, which the update addresses the comment by. */
  id: number;
  body: string;
}

/** The most files GitHub returns for a comparison; it silently leaves out the rest. */
export const MAX_COMPARE_FILES = 300;

/** A pull request's head and merge state, as the GraphQL `PullRequest` reports them. */
export interface MergeState {
  headOid: string;
  /** GitHub's `MergeStateStatus`, such as `CLEAN`, `BLOCKED` or `UNSTABLE`. */
  status: string;
  /** Whether auto-merge is on. */
  autoMergeEnabled: boolean;
  /** The commit this token's identity last approved, or `null` when its latest review is not an approval. */
  viewerApprovedOid: string | null;
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
      autoMergeRequest {
        enabledAt
      }
      viewerLatestReview {
        state
        commit {
          oid
        }
      }
    }
  }
}`;

/**
 * `viewerDidAuthor` is what keeps anyone else's comment, including one that copies the marker, from
 * being read as this action's state. The REST listing has no equivalent field.
 */
const COMMENTS_QUERY = `query Comments($pullRequestId: ID!, $cursor: String) {
  node(id: $pullRequestId) {
    ... on PullRequest {
      comments(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          databaseId
          body
          viewerDidAuthor
        }
      }
    }
  }
}`;

interface CommentsResponse {
  node: {
    comments?: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: ({ databaseId: number | null; body: string; viewerDidAuthor: boolean } | null)[];
    };
  } | null;
}

/** The subset of a compare response file this adapter reads. */
interface CompareFile {
  filename: string;
  previous_filename?: string;
  status: string;
  patch?: string;
  sha: string | null;
}

interface MergeStateResponse {
  node: {
    headRefOid?: string;
    mergeStateStatus?: string;
    autoMergeRequest?: { enabledAt: string | null } | null;
    viewerLatestReview?: { state: string; commit: { oid: string } | null } | null;
  } | null;
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
  base: { ref: string; sha: string; repo: { full_name: string } };
  user: { id: number } | null;
  auto_merge?: unknown;
}

function toOpenPullRequest(item: PullRequestListItem): OpenPullRequest {
  return {
    authorId: item.user?.id ?? null,
    baseRef: item.base.ref,
    baseSha: item.base.sha,
    baseRepoFullName: item.base.repo.full_name,
    createdAt: item.created_at,
    draft: item.draft === true,
    headRef: item.head.ref,
    headRepoFullName: item.head.repo?.full_name ?? null,
    headSha: item.head.sha,
    nodeId: item.node_id,
    number: item.number,
    url: item.html_url,
    autoMergeEnabled: item.auto_merge !== null && item.auto_merge !== undefined,
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

      const review = node.viewerLatestReview;

      return {
        autoMergeEnabled: node.autoMergeRequest !== null && node.autoMergeRequest !== undefined,
        headOid: node.headRefOid,
        status: node.mergeStateStatus,
        viewerApprovedOid: review?.state === 'APPROVED' ? (review.commit?.oid ?? null) : null,
      };
    },

    async merge({ owner, repo }, number, mergeMethod, sha) {
      await octokit.rest.pulls.merge({ merge_method: mergeMethod, owner, pull_number: number, repo, sha });
    },

    async createComment({ owner, repo }, number, body) {
      await octokit.rest.issues.createComment({ body, issue_number: number, owner, repo });
    },

    async updateComment({ owner, repo }, commentId, body) {
      await octokit.rest.issues.updateComment({ body, comment_id: commentId, owner, repo });
    },

    async fetchDiff({ owner, repo }, baseSha, headSha) {
      // Any paging parameter limits the commit list to that page while the file list stays whole, so
      // one commit per page keeps the response small.
      const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
        basehead: `${baseSha}...${headSha}`,
        owner,
        page: 1,
        per_page: 1,
        repo,
      });
      const files = (data.files ?? []) as CompareFile[];

      return {
        files: files.map((file) => ({
          filename: file.filename,
          patch: file.patch ?? null,
          previousFilename: file.previous_filename ?? null,
          sha: file.sha ?? null,
          status: file.status,
        })),
        truncated: files.length >= MAX_COMPARE_FILES,
      };
    },

    async findOwnComment(nodeId, matches) {
      let cursor: string | null = null;

      do {
        const response: CommentsResponse = await octokit.graphql<CommentsResponse>(COMMENTS_QUERY, {
          cursor,
          pullRequestId: nodeId,
        });
        const comments = response.node?.comments;

        if (!comments) {
          throw new Error(`Pull request ${nodeId} has no comment list.`);
        }

        for (const comment of comments.nodes) {
          if (comment?.viewerDidAuthor && comment.databaseId !== null && matches(comment.body)) {
            return { body: comment.body, id: comment.databaseId };
          }
        }

        cursor = comments.pageInfo.hasNextPage ? comments.pageInfo.endCursor : null;
      } while (cursor !== null);

      return undefined;
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
