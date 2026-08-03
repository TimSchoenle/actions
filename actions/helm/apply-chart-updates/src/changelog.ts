/**
 * Sanitization of the release changelog before it is carried into a pull request body.
 *
 * The changelog is the one input that is meant to be free-form prose, so it cannot be reduced to a
 * charset the way an image tag can. What it must not do is *act*. Two constructs in a GitHub pull
 * request body do something rather than say something:
 *
 * - `@name` notifies a person or a whole team, from a bot, on every release.
 * - A closing keyword — `Fixes #12`, `Closes https://github.com/o/r/issues/12` — **closes that issue
 *   when the pull request merges**. A changelog quoting the commit messages of the release it
 *   describes is very likely to contain several.
 *
 * Both are neutralized by breaking the token in the *source*, which is what GitHub parses, while
 * leaving the rendered text readable. Everything else is left alone: the changelog is supposed to
 * render as Markdown.
 */

/** Marker appended when the changelog did not fit. Visible on purpose — silent truncation is a lie. */
const TRUNCATION_MARKER = '\n\n_… changelog truncated_';

/** Control characters that carry no meaning in Markdown. Tab and newline are deliberately kept. */
// eslint-disable-next-line no-control-regex -- Stripping control characters requires naming them.
const CONTROL_CHARACTERS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * A mention: `@user` or `@org/team`, not preceded by a word character (so an email address is left
 * alone) and not preceded by a backtick (so an already-quoted mention is not double-handled).
 *
 * The handle is one flat character class rather than the strict `owner/team` grammar. Deliberately:
 * a nested quantifier would be a backtracking hazard for no benefit, since the goal is to break
 * anything that *could* notify someone, not to decide whether the handle is well-formed.
 */
const MENTION = /(^|[^\w`])@([A-Za-z0-9][A-Za-z0-9/_-]*)/g;

/**
 * A closing keyword followed by an issue reference, in either the `#123` or the full-URL form.
 * Matching the *keyword* rather than the reference is what makes one rule cover both forms.
 */
const CLOSING_REFERENCE = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)(\s*:?\s+)(#\d+|https?:\/\/\S+)/gi;

/** Replaces a character with its HTML entity, which renders as the character but parses as text. */
function toEntity(character: string): string {
  return `&#${character.codePointAt(0)};`;
}

/**
 * Truncates to at most `maxBytes` UTF-8 bytes, preferring a line boundary.
 *
 * Cutting mid-line in Markdown can leave an unterminated code fence or link, which swallows the rest
 * of the pull request body; cutting at the last newline keeps the remaining document well-formed.
 */
function truncateToBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();

  if (encoder.encode(text).length <= maxBytes) {
    return text;
  }

  const budget = Math.max(0, maxBytes - encoder.encode(TRUNCATION_MARKER).length);

  // Walk by code point so a multi-byte character is never split in half.
  let kept = '';
  let used = 0;

  for (const character of text) {
    const size = encoder.encode(character).length;

    if (used + size > budget) {
      break;
    }

    kept += character;
    used += size;
  }

  const lastNewline = kept.lastIndexOf('\n');

  return `${(lastNewline === -1 ? kept : kept.slice(0, lastNewline)).trimEnd()}${TRUNCATION_MARKER}`;
}

/**
 * Returns the changelog in a form that is safe to paste into a pull request body.
 *
 * Idempotent: sanitized output contains no mention and no closing reference, so re-running changes
 * nothing.
 */
export function sanitizeChangelog(raw: string, maxBytes: number): string {
  if (raw.trim() === '') {
    return '';
  }

  const normalized = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(CONTROL_CHARACTERS, '');

  // Mentions first: escaping a keyword introduces `&#…;`, and handling the `@` afterwards would have
  // to reason about text this module itself wrote.
  const withoutMentions = normalized.replace(MENTION, (_match, prefix: string, name: string) => {
    return `${prefix}${toEntity('@')}${name}`;
  });

  const withoutClosers = withoutMentions.replace(
    CLOSING_REFERENCE,
    (_match, keyword: string, separator: string, reference: string) => {
      return `${toEntity(keyword.charAt(0))}${keyword.slice(1)}${separator}${reference}`;
    },
  );

  return truncateToBytes(withoutClosers.trimEnd(), maxBytes);
}
