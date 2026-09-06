import { CommentUnavailableError } from './comment-api.js';
import { composeBody, hasMarker, markerFor } from './marker.js';

import type { CommentApi, CommentRef, ExistingComment } from './comment-api.js';
import type { PullRequestCoordinates } from 'actions-util';

/** Everything read from the action inputs that the decision needs. */
export interface UpsertRequest {
  /** The pull request to comment on. */
  target: PullRequestCoordinates;
  /** Stable key naming the comment, turned into the hidden marker. */
  identifier: string;
  /** Markdown the caller wants the comment to carry. */
  body: string;
  /** Whether a previous comment carrying the identifier is updated rather than added to. */
  updateExisting: boolean;
  /** Login the previous comment must have been posted by; empty accepts any author. */
  author: string;
}

/** What the run did to the pull request. */
export type CommentOperation = 'created' | 'updated' | 'unchanged';

/** The outcome, in the terms the step log and the action outputs report. */
export interface UpsertOutcome {
  operation: CommentOperation;
  comment: CommentRef;
  /** Whether the body had to be cut to fit GitHub's size limit. */
  truncated: boolean;
  /** Why a new comment was posted although an existing one had been found. */
  fallbackReason?: string;
}

/**
 * The first comment carrying the marker, or `undefined`.
 *
 * *First*, not *best*: the comments arrive oldest first, so this is the earliest one carrying the
 * marker, and the loop stops there. That choice is also what makes a duplicate self-correcting —
 * if two jobs race and both post, every later run converges on the same, older comment instead of
 * alternating between them.
 */
async function findMarked(
  api: CommentApi,
  target: PullRequestCoordinates,
  marker: string,
  author: string,
): Promise<ExistingComment | undefined> {
  for await (const comment of api.comments(target)) {
    if (hasMarker(comment.body, marker) && (author === '' || comment.author === author)) {
      return comment;
    }
  }

  return undefined;
}

/**
 * Posts the comment, replacing the previous one carrying the same identifier.
 *
 * The fallback is the point of the design: an update that fails because the comment is gone, or
 * because it belongs to somebody the token may not edit, becomes a new comment rather than a red
 * build. A workflow that reports a build size after every run has to keep reporting it when a
 * reviewer deletes last week's comment, and the alternative — failing the step — reports nothing at
 * all. Every other failure propagates, so a rate limit or an outage is never answered with a
 * duplicate.
 *
 * @throws {@link InvalidIdentifierError} if the identifier cannot be turned into a marker, and
 * whatever the API raises for a failure that posting again would not mend.
 */
export async function upsertComment(api: CommentApi, request: UpsertRequest): Promise<UpsertOutcome> {
  const marker = markerFor(request.identifier);
  const { text, truncated } = composeBody(request.identifier, request.body);

  const existing = request.updateExisting ? await findMarked(api, request.target, marker, request.author) : undefined;

  if (existing === undefined) {
    return { comment: await api.createComment(request.target, text), operation: 'created', truncated };
  }

  // A no-op write is still a write: it bumps the comment's timestamp, moves it in every "recently
  // updated" view and costs a request. An action that runs on every push does this often enough for
  // the comparison to be worth making.
  if (existing.body === text) {
    return { comment: { id: existing.id, url: existing.url }, operation: 'unchanged', truncated };
  }

  try {
    return { comment: await api.updateComment(request.target, existing.id, text), operation: 'updated', truncated };
  } catch (error) {
    if (!(error instanceof CommentUnavailableError)) {
      throw error;
    }

    return {
      comment: await api.createComment(request.target, text),
      fallbackReason: error.message,
      operation: 'created',
      truncated,
    };
  }
}
