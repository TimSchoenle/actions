import { hasStatus } from 'actions-util';
import { createOctokit } from 'actions-util/client';

import { CommentUnavailableError } from './comment-api.js';

import type { CommentApi, CommentRef, ExistingComment } from './comment-api.js';
import type { PullRequestCoordinates } from 'actions-util';

/** GitHub's ceiling on `per_page`, so a pull request's comments arrive in as few requests as possible. */
const MAX_PAGE_SIZE = 100;

/**
 * The statuses that mean the comment is gone: 404 for the comment itself — or for a repository the
 * token can no longer see, which GitHub does not distinguish — and 410 for its issue.
 *
 * A 403 is deliberately *not* here, although it is what GitHub answers when the token may comment but
 * may not edit somebody else's comment. Falling back on it would post a fresh comment on every single
 * run: the comment that provoked the refusal is still the oldest one carrying the marker, so the next
 * run finds it, is refused again, and adds another. Failing instead says exactly once that the marker
 * was found on a comment this identity does not own, which the `author` input is there to prevent.
 * A rate limit reports as 403 too, which is a second reason not to read that status as "deleted".
 */
const UNAVAILABLE_STATUSES = [404, 410];

/** Whether an update failure is one that posting a new comment would resolve. */
function isUnavailable(error: unknown): boolean {
  return UNAVAILABLE_STATUSES.some((status) => hasStatus(error, status));
}

/**
 * Binds the {@link CommentApi} to the GitHub REST API.
 *
 * Comments go through the issues endpoints because GitHub models a pull request as an issue with a
 * branch: `pulls.createReviewComment` would attach the text to a line of the diff rather than to the
 * conversation, and `pulls.listReviewComments` would never see what this action posts.
 */
export function createCommentApi(token: string): CommentApi {
  const octokit = createOctokit(token);

  return {
    async *comments({ number, owner, repo }: PullRequestCoordinates): AsyncIterable<ExistingComment> {
      // `octokit.paginate.iterator` is what keeps the early exit real: abandoning the loop after the
      // first match stops the generator, and the pages beyond it are never requested.
      const pages = octokit.paginate.iterator(octokit.rest.issues.listComments, {
        issue_number: number,
        owner,
        per_page: MAX_PAGE_SIZE,
        repo,
      });

      for await (const { data } of pages) {
        for (const comment of data) {
          yield { author: comment.user?.login ?? '', body: comment.body ?? '', id: comment.id, url: comment.html_url };
        }
      }
    },

    async createComment({ number, owner, repo }: PullRequestCoordinates, body: string): Promise<CommentRef> {
      const { data } = await octokit.rest.issues.createComment({ body, issue_number: number, owner, repo });

      return { id: data.id, url: data.html_url };
    },

    async updateComment({ owner, repo }: PullRequestCoordinates, commentId: number, body: string): Promise<CommentRef> {
      try {
        const { data } = await octokit.rest.issues.updateComment({ body, comment_id: commentId, owner, repo });

        return { id: data.id, url: data.html_url };
      } catch (error) {
        if (!isUnavailable(error)) {
          throw error;
        }

        throw new CommentUnavailableError(`comment ${commentId} can no longer be updated`, { cause: error });
      }
    },
  };
}
