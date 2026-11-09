import { hasStatus } from 'actions-util';
import { createOctokit } from 'actions-util/client';

import type { ActivityComment, ActivityReview, ReviewActivity } from './activity.js';
import type { PullRequestCoordinates } from 'actions-util';

/** A pull request reduced to the fields the trigger decision needs. */
export interface PullRequestInfo {
  /** `open` or `closed`; a merged pull request is `closed`. */
  state: string;
  draft: boolean;
  /** Login of the author, e.g. `renovate[bot]`. */
  authorLogin: string;
  /** Account type of the author as GitHub reports it: `User`, `Bot` or `Organization`. */
  authorType: string;
  /** Full name of the head repository, e.g. `owner/repo`. */
  headRepoFullName: string;
  /** Full name of the base repository, e.g. `owner/repo`. */
  baseRepoFullName: string;
  /** Branch the pull request targets. */
  baseRef: string;
  /** The pull request's current head commit. */
  headSha: string;
}

/** The account a token authenticates as. */
export interface TokenIdentity {
  login: string;
  /** `User` for a personal access token; anything else cannot drive CodeRabbit. */
  type: string;
}

/** A comment GitHub created. */
export interface PostedComment {
  id: number;
  url: string;
}

/** The GitHub operations this action needs, kept minimal so it can be faked in tests. */
export interface TriggerApi {
  /**
   * The account the token belongs to, or `undefined` when `GET /user` answers 403, which is what
   * `github.token` and every GitHub App installation token get.
   *
   * @throws if GitHub rejects the token outright (401): it is expired, revoked or malformed.
   */
  getTokenIdentity(): Promise<TokenIdentity | undefined>;
  getPullRequest(coordinates: PullRequestCoordinates): Promise<PullRequestInfo>;
  postComment(coordinates: PullRequestCoordinates, body: string): Promise<PostedComment>;
  /** The last {@link ACTIVITY_PAGE_SIZE} comments and reviews of the pull request. */
  getReviewActivity(coordinates: PullRequestCoordinates): Promise<ReviewActivity>;
  /** Collapses a comment as outdated. */
  minimizeComment(nodeId: string): Promise<void>;
}

/** How many of the latest comments and reviews are read; older ones are not looked at. */
export const ACTIVITY_PAGE_SIZE = 100;

const ACTIVITY_QUERY = `
  query ($owner: String!, $repo: String!, $number: Int!, $pageSize: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        comments(last: $pageSize) {
          nodes { id body createdAt updatedAt isMinimized author { __typename login } }
        }
        reviews(last: $pageSize) {
          nodes { body commit { oid } author { __typename login } }
        }
      }
    }
  }
`;

const MINIMIZE_MUTATION = `
  mutation ($subjectId: ID!) {
    minimizeComment(input: { subjectId: $subjectId, classifier: OUTDATED }) { clientMutationId }
  }
`;

interface GraphqlAuthor {
  __typename: string;
  login: string;
}

interface ActivityResponse {
  repository: {
    pullRequest: {
      comments: {
        nodes: ({
          id: string;
          body: string;
          createdAt: string;
          updatedAt: string;
          isMinimized: boolean;
          author: GraphqlAuthor | null;
        } | null)[];
      };
      reviews: { nodes: ({ body: string; commit: { oid: string } | null; author: GraphqlAuthor | null } | null)[] };
    } | null;
  } | null;
}

/** The author fields of a comment or review; a deleted account reads as an empty login. */
function authorOf(author: GraphqlAuthor | null): { authorLogin: string; authorIsBot: boolean } {
  return { authorIsBot: author?.__typename === 'Bot', authorLogin: author?.login ?? '' };
}

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;

export function createTriggerApi(token: string): TriggerApi {
  const octokit = createOctokit(token);

  return {
    async getPullRequest({ number, owner, repo }: PullRequestCoordinates): Promise<PullRequestInfo> {
      const { data } = await octokit.rest.pulls.get({ owner, pull_number: number, repo });

      const headRepoFullName = data.head.repo?.full_name;
      const baseRepoFullName = data.base.repo?.full_name;

      // A missing author or head repository must never read as "same repository, human author":
      // the fork and bot checks would pass by default. The head repository is absent only when the
      // fork was deleted.
      if (!data.user || !headRepoFullName || !baseRepoFullName) {
        throw new Error(`Incomplete data for pull request #${number}; refusing to evaluate it.`);
      }

      return {
        authorLogin: data.user.login,
        authorType: data.user.type,
        baseRef: data.base.ref,
        baseRepoFullName,
        draft: data.draft === true,
        headSha: data.head.sha,
        headRepoFullName,
        state: data.state,
      };
    },

    async getTokenIdentity(): Promise<TokenIdentity | undefined> {
      try {
        const { data } = await octokit.rest.users.getAuthenticated();

        return { login: data.login, type: data.type };
      } catch (error) {
        // An installation token gets 403 "Resource not accessible by integration".
        if (hasStatus(error, FORBIDDEN)) {
          return undefined;
        }
        // A fine-grained token expires, so this is the failure a working setup eventually hits. It
        // needs a new token, not a different kind of token, so it gets its own message.
        if (hasStatus(error, UNAUTHORIZED)) {
          throw new Error(
            'GitHub rejected the token (401 Bad credentials): it is expired, revoked or malformed. ' +
              'Create a new personal access token and update the secret.',
            { cause: error },
          );
        }
        throw error;
      }
    },

    async getReviewActivity({ number, owner, repo }: PullRequestCoordinates): Promise<ReviewActivity> {
      const response = await octokit.graphql<ActivityResponse>(ACTIVITY_QUERY, {
        number,
        owner,
        pageSize: ACTIVITY_PAGE_SIZE,
        repo,
      });
      const pullRequest = response.repository?.pullRequest;

      if (!pullRequest) {
        throw new Error(`GitHub returned no comments or reviews for pull request #${number}.`);
      }

      const comments: ActivityComment[] = pullRequest.comments.nodes
        .filter((node) => node !== null)
        .map((node) => ({
          ...authorOf(node.author),
          body: node.body,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
          isMinimized: node.isMinimized,
          nodeId: node.id,
        }));
      const reviews: ActivityReview[] = pullRequest.reviews.nodes
        .filter((node) => node !== null)
        .map((node) => ({ ...authorOf(node.author), body: node.body, commitSha: node.commit?.oid ?? '' }));

      return { comments, reviews };
    },

    async minimizeComment(nodeId: string): Promise<void> {
      await octokit.graphql(MINIMIZE_MUTATION, { subjectId: nodeId });
    },

    async postComment({ number, owner, repo }: PullRequestCoordinates, body: string): Promise<PostedComment> {
      const { data } = await octokit.rest.issues.createComment({ body, issue_number: number, owner, repo });

      return { id: data.id, url: data.html_url };
    },
  };
}
