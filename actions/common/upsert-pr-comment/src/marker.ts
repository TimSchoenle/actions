/**
 * The hidden marker that lets a later run find the comment an earlier one posted.
 *
 * GitHub keeps an HTML comment in a comment's raw body and hides it from the rendered view, so a
 * marker line is invisible to a reviewer and exactly matchable by the action. That is the whole
 * mechanism: no state is carried between runs, and a workflow re-run — or a run on a different
 * runner, in a different job, after the cache was wiped — finds the same comment from the body alone.
 */

/**
 * Namespace every marker carries, so a key like `size` cannot collide with the sticky-comment
 * conventions of Dependabot, Renovate or any of the third-party comment actions a repository may also
 * be running.
 */
const MARKER_NAMESPACE = 'timschoenle/actions:pr-comment';

/**
 * The keys an identifier may be built from.
 *
 * Validation rather than escaping, and deliberately so: an identifier containing `-->` closes the
 * marker and injects markdown ahead of the caller's body, and one containing a newline breaks the
 * line-exact match that finding the comment depends on. Both are cured by refusing the character —
 * escaping would leave the marker parseable only by whatever wrote it.
 */
const IDENTIFIER_PATTERN = /^[\dA-Za-z][\w.-]{0,63}$/;

/** GitHub's ceiling on an issue comment body, in UTF-16 code units, as its API reports it. */
export const MAX_COMMENT_LENGTH = 65_536;

/** Appended to a body this action had to cut, so a reader is never left guessing why it ends mid-row. */
const TRUNCATION_NOTICE = '\n\n_The rest of this comment was cut: it exceeded the size GitHub accepts._';

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
        `got ${JSON.stringify(identifier)}`,
    );
  }

  return `<!-- ${MARKER_NAMESPACE}:${identifier} -->`;
}

/** Whether a comment body carries this marker, on a line of its own. */
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
 * astral character — an emoji in a build report is enough — leaves a lone surrogate that GitHub
 * stores and every reader renders as a replacement character.
 */
function sliceWholeCharacters(body: string, limit: number): string {
  const cut = body.slice(0, limit);
  const last = cut.codePointAt(cut.length - 1);

  return last !== undefined && last >= 0xd8_00 && last <= 0xdb_ff ? cut.slice(0, -1) : cut;
}

/**
 * Builds the body to post: the marker, then the caller's markdown.
 *
 * The marker goes first so that truncating the tail can never remove it — a comment that lost its
 * marker is one the next run cannot find, and it would silently become an unbounded series of new
 * comments. Overflowing is truncated rather than rejected: a size report that grew past the limit is
 * a reason to shorten the comment, not to fail the build that produced it.
 *
 * @throws {@link InvalidIdentifierError} if the identifier cannot be turned into a marker.
 */
export function composeBody(identifier: string, body: string): ComposedBody {
  const prefix = `${markerFor(identifier)}\n\n`;
  const text = prefix + body;

  if (text.length <= MAX_COMMENT_LENGTH) {
    return { text, truncated: false };
  }

  const room = MAX_COMMENT_LENGTH - prefix.length - TRUNCATION_NOTICE.length;

  return { text: prefix + sliceWholeCharacters(body, room) + TRUNCATION_NOTICE, truncated: true };
}
