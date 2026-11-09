/**
 * Reads what has already happened on a pull request, so the action neither asks CodeRabbit twice
 * for the same commit nor leaves a trail of old commands and replies.
 *
 * Every command the action posts carries a hidden marker with the head commit it asked about. Only
 * markers in comments by the token's own account count, so nobody else can suppress a review by
 * pasting one.
 *
 * @packageDocumentation
 */

/** A comment on the pull request conversation. */
export interface ActivityComment {
  /** GraphQL node id, which is what `minimizeComment` takes. */
  nodeId: string;
  /** Login as GraphQL reports it; a bot has no `[bot]` suffix there. Empty for a deleted account. */
  authorLogin: string;
  authorIsBot: boolean;
  body: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp of the last edit, or of creation for a comment never edited. */
  updatedAt: string;
  isMinimized: boolean;
}

/** A review submitted on the pull request. */
export interface ActivityReview {
  authorLogin: string;
  authorIsBot: boolean;
  /** The commit the review was submitted on, or empty when GitHub no longer has it. */
  commitSha: string;
  body: string;
}

/** The most recent comments and reviews of a pull request. */
export interface ReviewActivity {
  comments: readonly ActivityComment[];
  reviews: readonly ActivityReview[];
}

/** Why a command was not posted although the pull request passed every other rule. */
export type DuplicateReason = 'already-reviewed' | 'already-requested';

const CODERABBIT_LOGINS = new Set(['coderabbitai', 'coderabbitai[bot]']);
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MARKER = /<!-- trigger-coderabbit-review head=([0-9a-f]{40}|[0-9a-f]{64}) -->\s*$/;
/** CodeRabbit puts this in every reply to a review command, whether the command worked or not. */
const COMMAND_REPLY = '<!-- CodeRabbit review command invocation:';
/** The summary of a reply to a command CodeRabbit did not carry out, such as a rate-limited one. */
const NOT_COMPLETED = '<summary>Action not completed</summary>';

/**
 * The comment body for `command` on `headSha`: the command on its own line, then the marker.
 *
 * @throws if `headSha` is not a full commit id, since it becomes part of the comment.
 */
export function commandBody(command: string, headSha: string): string {
  if (!COMMIT_SHA.test(headSha)) {
    throw new Error(`Refusing to mark a comment with ${JSON.stringify(headSha)}: it is not a full commit id.`);
  }

  return `@coderabbitai ${command}\n\n<!-- trigger-coderabbit-review head=${headSha} -->`;
}

/** The head commit a comment of this action asked about, or `undefined` for any other comment. */
export function markedHead(body: string): string | undefined {
  return MARKER.exec(body)?.[1];
}

function isCodeRabbit(author: { authorLogin: string; authorIsBot: boolean }): boolean {
  return author.authorIsBot && CODERABBIT_LOGINS.has(author.authorLogin.toLowerCase());
}

function isCommandReply(comment: ActivityComment): boolean {
  return isCodeRabbit(comment) && comment.body.includes(COMMAND_REPLY);
}

function isOwnMarkedComment(comment: ActivityComment, actor: string): boolean {
  // GraphQL drops the `[bot]` suffix, so an app named like the actor must not pass as the actor.
  return (
    !comment.authorIsBot &&
    comment.authorLogin.toLowerCase() === actor.toLowerCase() &&
    markedHead(comment.body) !== undefined
  );
}

/**
 * Whether asking CodeRabbit about `headSha` again would be a duplicate:
 *
 * - `already-reviewed`: CodeRabbit submitted a review with a body on that commit. Its replies in
 *   review threads are reviews too, but with an empty body, and do not count.
 * - `already-requested`: `actor` already posted a marked command for that commit, and CodeRabbit
 *   has not answered any command with "Action not completed" since. A rate-limited or refused
 *   request is asked again on the next run. A reply counts by its last edit, so one CodeRabbit
 *   rewrote after the request counts too, and timestamps in the same second count as after,
 *   since GitHub records only whole seconds.
 */
export function duplicateReason(activity: ReviewActivity, headSha: string, actor: string): DuplicateReason | undefined {
  const reviewed = activity.reviews.some(
    (review) => isCodeRabbit(review) && review.commitSha === headSha && review.body.trim() !== '',
  );
  if (reviewed) {
    return 'already-reviewed';
  }

  const latestRequest = activity.comments
    .filter((comment) => isOwnMarkedComment(comment, actor) && markedHead(comment.body) === headSha)
    .map((comment) => comment.createdAt)
    .sort()
    .at(-1);
  if (latestRequest === undefined) {
    return undefined;
  }

  const failedSince = activity.comments.some(
    (comment) => isCommandReply(comment) && comment.body.includes(NOT_COMPLETED) && comment.updatedAt >= latestRequest,
  );

  return failedSince ? undefined : 'already-requested';
}

/**
 * The comments a new command makes outdated: earlier marked commands of `actor`, and every
 * CodeRabbit reply to a review command. Comments already collapsed are left out.
 */
export function outdatedComments(activity: ReviewActivity, actor: string): string[] {
  return activity.comments
    .filter((comment) => !comment.isMinimized && (isOwnMarkedComment(comment, actor) || isCommandReply(comment)))
    .map((comment) => comment.nodeId);
}
