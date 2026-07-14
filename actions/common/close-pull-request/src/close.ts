import { parseRepository } from 'actions-util';

import type { RepositoryCoordinates } from 'actions-util';

/** The pull request operations this action needs, kept minimal so it can be faked in tests. */
export interface PullRequestApi {
  /** Resolves whether the pull request exists and is readable. Throws for any error other than "not found". */
  pullRequestExists(repository: RepositoryCoordinates, pullRequestNumber: number): Promise<boolean>;
  /** Posts a comment on the pull request. */
  commentOnPullRequest(repository: RepositoryCoordinates, pullRequestNumber: number, comment: string): Promise<void>;
  /** Closes the pull request. Closing an already-closed pull request succeeds without changing it. */
  closePullRequest(repository: RepositoryCoordinates, pullRequestNumber: number): Promise<void>;
}

export interface CloseRequest {
  /** Repository the pull request lives in, e.g. `owner/repo`. */
  repository: string;
  /** Number of the pull request to close, as read from the action input. */
  pullRequestId: string;
  /** Comment to post before closing. Empty posts nothing. */
  comment: string;
}

export interface CloseResult {
  /** Whether the pull request was closed. `false` means it does not exist — not that closing failed. */
  closed: boolean;
  /** Whether a comment was posted — useful for logging and for the caller's audit trail. */
  commented: boolean;
  /** The validated pull request number, so callers can report on it without re-parsing the input. */
  pullRequestNumber: number;
}

/** Renders the reason an API call failed, without leaking a non-`Error` rejection as `[object Object]`. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Raised when the comment that must precede the close cannot be posted.
 *
 * Kept distinct from a close failure: the pull request is still open at this point, so the caller's
 * retry is a full retry, not a "comment already posted" one.
 */
export class PullRequestCommentError extends Error {
  constructor(
    readonly repository: string,
    readonly pullRequestNumber: number,
    cause: unknown,
  ) {
    super(`Failed to comment on PR #${pullRequestNumber} in ${repository}: ${describe(cause)}`, { cause });
    this.name = 'PullRequestCommentError';
  }
}

/**
 * Raised when an existing pull request cannot be closed.
 *
 * Never silenced: a token without write access, a rate limit or a server error would otherwise be
 * reported as `closed=false`, which callers read as "the pull request was already gone".
 */
export class PullRequestCloseError extends Error {
  constructor(
    readonly repository: string,
    readonly pullRequestNumber: number,
    cause: unknown,
  ) {
    super(`Failed to close PR #${pullRequestNumber} in ${repository}: ${describe(cause)}`, { cause });
    this.name = 'PullRequestCloseError';
  }
}

const PULL_REQUEST_ID_PATTERN = /^\d+$/;

/**
 * Parses the pull request number.
 *
 * Rejected up front rather than handed to the API: a non-numeric or zero id produces a 404, which
 * this action reports as "the pull request does not exist" — turning a typo in a workflow into a
 * silently skipped close.
 */
export function parsePullRequestId(pullRequestId: string): number {
  if (!PULL_REQUEST_ID_PATTERN.test(pullRequestId) || Number(pullRequestId) === 0) {
    throw new Error(`Invalid pull_request_id '${pullRequestId}'. Expected a positive integer.`);
  }

  return Number(pullRequestId);
}

/**
 * Closes the pull request, posting the optional comment first, and reports whether it existed.
 *
 * A pull request that does not exist is not an error — the action is used to clean up branches whose
 * pull request may already have been closed and deleted, so its absence is the desired end state and
 * yields `closed: false`.
 *
 * Closing an already-closed pull request yields `closed: true`: the underlying request is idempotent,
 * and the caller asked for the pull request to end up closed, which it is.
 *
 * The comment is posted before the close, mirroring `gh pr close --comment`, so a reader of the
 * pull request sees the reason above the close event rather than below it.
 *
 * @throws {PullRequestCommentError} if the comment cannot be posted; the pull request stays open.
 * @throws {PullRequestCloseError} if an existing pull request cannot be closed.
 */
export async function closePullRequestIfPresent(api: PullRequestApi, request: CloseRequest): Promise<CloseResult> {
  const coordinates = parseRepository(request.repository);
  const pullRequestNumber = parsePullRequestId(request.pullRequestId);

  if (!(await api.pullRequestExists(coordinates, pullRequestNumber))) {
    return { closed: false, commented: false, pullRequestNumber };
  }

  const comment = request.comment;

  if (comment !== '') {
    try {
      await api.commentOnPullRequest(coordinates, pullRequestNumber, comment);
    } catch (error) {
      throw new PullRequestCommentError(request.repository, pullRequestNumber, error);
    }
  }

  try {
    await api.closePullRequest(coordinates, pullRequestNumber);
  } catch (error) {
    throw new PullRequestCloseError(request.repository, pullRequestNumber, error);
  }

  return { closed: true, commented: comment !== '', pullRequestNumber };
}
