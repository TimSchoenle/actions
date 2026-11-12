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
 * A complete inline code span on one line, or a mention: `@user` or `@org/team` not preceded by a
 * letter or digit, so an email address is left alone. GitHub links a mention after `_` (emphasis) or
 * after a backtick that opens no span, so only those two characters are not enough to skip it. A
 * mention inside a complete span renders as code and notifies nobody, so the span is kept as written.
 *
 * The handle is one flat character class rather than the strict `owner/team` grammar. Deliberately:
 * a nested quantifier would be a backtracking hazard for no benefit, since the goal is to break
 * anything that *could* notify someone, not to decide whether the handle is well-formed.
 */
const MENTION = /(`[^`\n]*`)|(^|[^A-Za-z0-9])@([A-Za-z0-9][A-Za-z0-9/_-]*)/g;

/**
 * A closing keyword followed by an issue reference: `#123`, `owner/repo#123` or a full URL. The keyword
 * is matched after any character but a letter or digit, so `_fixes #12_` in emphasis counts. Matching
 * the *keyword* rather than the reference is what makes one rule cover every form.
 */
const CLOSING_REFERENCE =
  /(^|[^A-Za-z0-9])(close[sd]?|fix(?:e[sd])?|resolve[sd]?)(\s*:?\s+)(#\d+|[\w.-]+\/[\w.-]+#\d+|https?:\/\/\S+)/gi;

/** A line that opens or closes a fenced code block, with its marker: three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Replaces a character with its HTML entity, which renders as the character but parses as text. */
function toEntity(character: string): string {
  return `&#${character.codePointAt(0)};`;
}

/** The marker of the fenced code block still open at the end of `text`, if one is. */
function openFence(text: string): string | undefined {
  let open: string | undefined;
  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (marker === undefined) {
      continue;
    }
    if (open === undefined) {
      open = marker;
    } else if (marker[0] === open[0] && marker.length >= open.length) {
      open = undefined;
    }
  }

  return open;
}

/**
 * Truncates to at most `maxBytes` UTF-8 bytes, preferring a line boundary.
 *
 * Cutting mid-line in Markdown can leave an unterminated code fence or link, which swallows the rest
 * of the pull request body; cutting at the last newline keeps the remaining document well-formed. A
 * fenced block the cut falls inside is closed with its own marker, dropping lines until the closer
 * fits.
 */
function truncateToBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const size = (value: string): number => encoder.encode(value).length;

  if (size(text) <= maxBytes) {
    return text;
  }

  const budget = Math.max(0, maxBytes - size(TRUNCATION_MARKER));

  // Walk by code point so a multi-byte character is never split in half.
  let kept = '';
  let used = 0;

  for (const character of text) {
    const characterSize = size(character);

    if (used + characterSize > budget) {
      break;
    }

    kept += character;
    used += characterSize;
  }

  let lines = kept.split('\n');
  if (lines.length > 1) {
    lines = lines.slice(0, -1);
  }
  for (;;) {
    const body = lines.join('\n').trimEnd();
    const fence = openFence(body);
    const closed = fence === undefined ? body : `${body}\n${fence}`;
    if (size(closed) <= budget || lines.length <= 1) {
      return `${closed}${TRUNCATION_MARKER}`;
    }
    lines = lines.slice(0, -1);
  }
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
  const withoutMentions = normalized.replace(MENTION, (match, span: string | undefined, prefix: string, name: string) =>
    span === undefined ? `${prefix}${toEntity('@')}${name}` : match,
  );

  const withoutClosers = withoutMentions.replace(
    CLOSING_REFERENCE,
    (_match, prefix: string, keyword: string, separator: string, reference: string) =>
      `${prefix}${toEntity(keyword.charAt(0))}${keyword.slice(1)}${separator}${reference}`,
  );

  return truncateToBytes(withoutClosers.trimEnd(), maxBytes);
}
