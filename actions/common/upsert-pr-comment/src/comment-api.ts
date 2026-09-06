/**
 * The GitHub operations this action needs, named so the decision in `upsert.ts` can be tested without
 * an HTTP client and so nothing above this line has to know what a status code is.
 */
import type { PullRequestCoordinates } from 'actions-util';

/** A comment this run created or updated, reduced to what the action publishes as outputs. */
export interface CommentRef {
  id: number;
  url: string;
}

/** A comment already on the pull request, reduced to what the decision reads. */
export interface ExistingComment extends CommentRef {
  body: string;
  /** Login of whoever posted it, e.g. `my-app[bot]`. */
  author: string;
}

/**
 * Raised when a comment is gone, and posting a new one is the right answer.
 *
 * Reserved for exactly that: the comment, or the issue holding it, no longer exists. Neither is under
 * the caller's control and neither is a reason to fail a build. Everything else propagates — a rate
 * limit that outlived its retries, a network failure, a refusal to edit a comment this identity does
 * not own — because none of them is mended by posting a duplicate, and a refusal that repeats every
 * run would add a comment every run.
 */
export class CommentUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CommentUnavailableError';
  }
}

/** The GitHub operations this action needs, kept minimal so it can be faked in tests. */
export interface CommentApi {
  /**
   * Every comment on the pull request, oldest first.
   *
   * An iterable rather than an array because the caller stops at the first match, which on a long
   * pull request is the difference between one request and a dozen.
   */
  comments(target: PullRequestCoordinates): AsyncIterable<ExistingComment>;
  /** Posts a new comment on the pull request. */
  createComment(target: PullRequestCoordinates, body: string): Promise<CommentRef>;
  /**
   * Replaces the body of an existing comment.
   *
   * @throws {@link CommentUnavailableError} if the comment can no longer be edited.
   */
  updateComment(target: PullRequestCoordinates, commentId: number, body: string): Promise<CommentRef>;
}
