/**
 * The hidden marker that lets a later run find the issue an earlier one opened.
 *
 * GitHub keeps an HTML comment in an issue's raw body and hides it from the rendered view, so a
 * marker line is invisible to a reader and exactly matchable by the action. That is the whole
 * mechanism: no state is carried between runs, and a workflow re-run -- or a run on a different
 * runner, in a different job, after the cache was wiped -- finds the same issue from the body alone.
 */
import { quoteForLog } from 'actions-util';

/**
 * Namespace every marker carries, so a key like `repo-state` cannot collide with the sticky-issue
 * conventions of a third-party issue-management action a repository may also be running.
 */
const MARKER_NAMESPACE = 'timschoenle/actions:issue';

/**
 * The keys an identifier may be built from.
 *
 * Validation rather than escaping, and deliberately so: an identifier containing `-->` closes the
 * marker and injects markdown ahead of the caller's body, and one containing a newline breaks the
 * line-exact match that finding the issue depends on. Both are cured by refusing the character --
 * escaping would leave the marker parseable only by whatever wrote it.
 */
const IDENTIFIER_PATTERN = /^[\dA-Za-z][\w.-]{0,63}$/;

/** GitHub's ceiling on an issue body, in UTF-16 code units, as its API reports it -- the same limit as a comment. */
export const MAX_ISSUE_BODY_LENGTH = 65_536;

/** Appended to a body this action had to cut, so a reader is never left guessing why it ends mid-row. */
const TRUNCATION_NOTICE = '\n\n_The rest of this issue was cut: it exceeded the size GitHub accepts._';

/** Raised when an identifier cannot be turned into a marker. */
export class InvalidIdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIdentifierError';
  }
}

/**
 * The marker line for an identifier.
 *
 * @throws {@link InvalidIdentifierError} if the identifier is empty or carries a character that
 * would let it escape the marker.
 */
export function markerFor(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new InvalidIdentifierError(
      `identifier must be 1-64 characters of letters, digits, '.', '_' or '-', starting with a letter or digit, ` +
        `got ${quoteForLog(identifier)}`,
    );
  }

  return `<!-- ${MARKER_NAMESPACE}:${identifier} -->`;
}

/** Whether an issue body carries this marker, on a line of its own. */
export function hasMarker(body: string, marker: string): boolean {
  return body.split('\n').some((line) => line.trim() === marker);
}

/** A body composed for posting, and whether anything had to be cut to fit. */
export interface ComposedBody {
  text: string;
  truncated: boolean;
}

/**
 * Trims a body to `limit` code units without splitting a surrogate pair.
 *
 * `String.prototype.slice` counts UTF-16 code units, so a cut landing between the halves of an
 * astral character -- an emoji in a generated report is enough -- leaves a lone surrogate that
 * GitHub stores and every reader renders as a replacement character.
 */
function sliceWholeCharacters(body: string, limit: number): string {
  const cut = body.slice(0, limit);
  const last = cut.codePointAt(cut.length - 1);

  return last !== undefined && last >= 0xd8_00 && last <= 0xdb_ff ? cut.slice(0, -1) : cut;
}

/**
 * Builds the body to post: the marker, then the caller's markdown.
 *
 * The marker goes first so that truncating the tail can never remove it -- an issue that lost its
 * marker is one the next run cannot find, and it would silently become an unbounded series of new
 * issues. Overflowing is truncated rather than rejected: a report that grew past the limit is a
 * reason to shorten the issue, not to fail the build that produced it.
 *
 * @throws {@link InvalidIdentifierError} if the identifier cannot be turned into a marker.
 */
export function composeBody(identifier: string, body: string): ComposedBody {
  const prefix = `${markerFor(identifier)}\n\n`;
  const text = prefix + body;

  if (text.length <= MAX_ISSUE_BODY_LENGTH) {
    return { text, truncated: false };
  }

  const room = MAX_ISSUE_BODY_LENGTH - prefix.length - TRUNCATION_NOTICE.length;

  return { text: prefix + sliceWholeCharacters(body, room) + TRUNCATION_NOTICE, truncated: true };
}
