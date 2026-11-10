/**
 * Lists of repository paths as workflows pass them: a newline-separated list, or the JSON array
 * another step's output holds.
 *
 * @packageDocumentation
 */
import { sortedUnique, toRepoPath } from './paths.js';

/**
 * Parses `text` into sorted, deduplicated repository-relative paths.
 *
 * Text starting with `[` is read as a JSON array of strings, which is what `resolve-actions` outputs.
 * Anything else is one path per line; blank lines and surrounding whitespace are dropped.
 *
 * @param text - the input value
 * @param what - how one entry is described in an error message
 * @throws an `Error` for malformed JSON, a non-string entry, or an entry {@link toRepoPath} rejects
 */
export function parsePathList(text: string, what = 'path'): string[] {
  const trimmed = text.trim();
  if (trimmed === '') {
    return [];
  }

  let entries: unknown[];
  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`The ${what} list starts with '[' but is not a JSON array: ${(error as Error).message}`, {
        cause: error,
      });
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`The ${what} list starts with '[' but is not a JSON array.`);
    }
    entries = parsed;
  } else {
    entries = trimmed.split(/\r?\n/).map((line) => line.trim());
  }

  return sortedUnique(
    entries
      .filter((entry) => entry !== '')
      .map((entry) => {
        if (typeof entry !== 'string') {
          throw new TypeError(`Every ${what} must be a string; got ${JSON.stringify(entry)}.`);
        }

        return toRepoPath(entry, what);
      }),
  );
}
