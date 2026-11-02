import { hasStatus } from 'actions-util';
import { createOctokit } from 'actions-util/client';

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
   * The account the token belongs to, or `undefined` when the token cannot read `GET /user`, which
   * is the case for `github.token` and every GitHub App installation token.
   */
  getTokenIdentity(): Promise<TokenIdentity | undefined>;
  getPullRequest(coordinates: PullRequestCoordinates): Promise<PullRequestInfo>;
  postComment(coordinates: PullRequestCoordinates, body: string): Promise<PostedComment>;
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
        baseRepoFullName,
        draft: data.draft === true,
        headRepoFullName,
        state: data.state,
      };
    },

    async getTokenIdentity(): Promise<TokenIdentity | undefined> {
      try {
        const { data } = await octokit.rest.users.getAuthenticated();

        return { login: data.login, type: data.type };
      } catch (error) {
        // An installation token gets 403 "Resource not accessible by integration". 401 is a revoked
        // or malformed token, which is equally unable to post as a user.
        if (hasStatus(error, FORBIDDEN) || hasStatus(error, UNAUTHORIZED)) {
          return undefined;
        }
        throw error;
      }
    },

    async postComment({ number, owner, repo }: PullRequestCoordinates, body: string): Promise<PostedComment> {
      const { data } = await octokit.rest.issues.createComment({ body, issue_number: number, owner, repo });

      return { id: data.id, url: data.html_url };
    },
  };
}
