/**
 * The `allowed_paths` glob dialect: deliberately small, so what a pattern admits is obvious from
 * reading it.
 *
 * - `*` matches any run of characters within one path segment, including none and including a
 *   leading `.`. Unlike a shell, a dotfile is not special: the allowlist is about which files a bot
 *   may write, and a hidden file is still a file.
 * - `?` matches exactly one character within a segment.
 * - `**` matches any number of whole segments, including none, and must be a segment of its own.
 * - Everything else is literal. Character classes, braces, negation and escapes are refused rather
 *   than half-supported, so a pattern never means something other than it appears to.
 *
 * Matching is anchored at both ends and case-sensitive, as git paths are.
 */

/** Raised when an `allowed_paths` entry uses syntax outside the dialect above. */
export class GlobSyntaxError extends Error {
  constructor(pattern: string, reason: string) {
    super(`allowed_paths entry ${JSON.stringify(pattern)} is invalid: ${reason}`);
    this.name = 'GlobSyntaxError';
  }
}

/** Longest accepted pattern. Generous for any real path, short enough to bound matching cost. */
const MAX_PATTERN_LENGTH = 1024;

/** Characters that would introduce syntax this dialect does not support. */
const UNSUPPORTED = /[[\]{}\\!]/;

/** Escapes a literal for use inside a regular expression. */
function escapeLiteral(text: string): string {
  return text.replaceAll(/[$()*+.?^|]/g, String.raw`\$&`);
}

/** Translates one segment that is not `**`. */
function segmentSource(pattern: string, segment: string): string {
  if (segment.includes('**')) {
    throw new GlobSyntaxError(pattern, "'**' must be a whole path segment, as in 'dist/**' or '**/index.js'");
  }

  let source = '';
  for (const character of segment) {
    if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += escapeLiteral(character);
    }
  }

  return source;
}

/** Rejects anything outside the dialect, with the reason a workflow author needs to fix it. */
function assertSupported(pattern: string): void {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new GlobSyntaxError(pattern, `longer than ${MAX_PATTERN_LENGTH} characters`);
  }
  if (UNSUPPORTED.test(pattern)) {
    throw new GlobSyntaxError(pattern, "character classes, braces, '!' and '\\' are not supported");
  }
  if (pattern.startsWith('/')) {
    throw new GlobSyntaxError(pattern, 'patterns are relative to the repository root and must not start with /');
  }

  for (const segment of pattern.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new GlobSyntaxError(pattern, "empty, '.' and '..' segments are not allowed");
    }
  }
}

/** Compiles one pattern to an anchored regular expression source. */
export function globToRegExpSource(pattern: string): string {
  assertSupported(pattern);

  const segments = pattern.split('/');
  let source = '';

  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;

    if (segment === '**') {
      // A trailing `**` takes the rest of the path; an inner or leading one takes whole segments.
      source += last ? '.+' : '(?:[^/]+/)*';
    } else {
      source += segmentSource(pattern, segment) + (last ? '' : '/');
    }
  }

  return `^${source}$`;
}

/** A compiled allowlist. */
export interface PathAllowlist {
  /** The patterns as written, for messages. */
  readonly patterns: readonly string[];
  /** True when `path` matches at least one pattern. */
  matches(path: string): boolean;
}

/**
 * Compiles the whitespace-separated `allowed_paths` input.
 *
 * @throws {GlobSyntaxError} for an empty list or any pattern outside the dialect.
 */
export function compileAllowlist(input: string): PathAllowlist {
  const patterns = input.split(/\s+/).filter((pattern) => pattern !== '');

  if (patterns.length === 0) {
    throw new GlobSyntaxError(input, 'at least one pattern is required');
  }

  // The sources are built only from escaped literals and the fixed fragments above, never from raw
  // input, so the non-literal RegExp here cannot be steered into an arbitrary expression.
  // eslint-disable-next-line security/detect-non-literal-regexp
  const expressions = patterns.map((pattern) => new RegExp(globToRegExpSource(pattern), 'u'));

  return {
    matches: (path) => expressions.some((expression) => expression.test(path)),
    patterns,
  };
}
