/**
 * Repository-relative paths, the one path form every function in this package takes and returns.
 *
 * A repository-relative path is POSIX-separated, has no leading `./`, no `.` or `..` segment, no
 * empty segment and no control character. The repository root itself is `.`. Paths in this form
 * compare equal exactly when they name the same file, so they can be used as set members and map
 * keys, and they can be written into a workflow or a manifest without further escaping.
 *
 * @packageDocumentation
 */
import path from 'node:path';

/** The repository root, as a repository-relative path. */
export const ROOT = '.';

/** Raised for a path that is not, or cannot be turned into, a repository-relative path. */
export class InvalidPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPathError';
  }
}

/** Whether `value` contains U+0000 to U+001F or U+007F, which no accepted path or label may carry. */
export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

/**
 * Normalises `value` to a repository-relative path, or throws.
 *
 * Accepts a leading `./`, a trailing `/` and backslash separators, because those are how the same
 * path arrives from a workflow input, a `uses:` reference or a Windows checkout. Rejects everything
 * that could name a file outside the repository: an absolute path, a drive letter, and any `..`
 * segment, even one that would resolve back inside, since a manifest that needs one is malformed.
 *
 * @param value - the path to normalise
 * @param what - how the path is described in an error message
 * @throws {@link InvalidPathError} when the path is empty, absolute, contains a control character or
 * a `..` segment
 */
export function toRepoPath(value: string, what = 'path'): string {
  if (value.trim() === '') {
    throw new InvalidPathError(`${what} is empty.`);
  }
  if (hasControlCharacter(value)) {
    throw new InvalidPathError(`${what} ${JSON.stringify(value)} contains a control character.`);
  }

  const slashed = value.replaceAll('\\', '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    throw new InvalidPathError(
      `${what} ${JSON.stringify(value)} is absolute; expected a path relative to the repository.`,
    );
  }

  const segments = slashed.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) {
    throw new InvalidPathError(`${what} ${JSON.stringify(value)} contains a '..' segment.`);
  }

  return segments.length === 0 ? ROOT : segments.join('/');
}

/** Joins repository-relative segments, treating `.` as the root. */
export function joinRepoPath(...parts: string[]): string {
  return toRepoPath(path.posix.join(...parts.map((part) => (part === ROOT ? '' : part)), '.'));
}

/** The directory containing `file`; `.` for a file at the root. */
export function parentOf(file: string): string {
  const parent = path.posix.dirname(file);

  return parent === '' ? ROOT : parent;
}

/**
 * Whether `file` is `directory` itself or lies below it.
 *
 * Both must already be repository-relative. Compared by segment, so `actions/a` does not contain
 * `actions/ab`.
 */
export function isWithin(directory: string, file: string): boolean {
  return directory === ROOT || file === directory || file.startsWith(`${directory}/`);
}

/** Converts a repository-relative path to an absolute one under `root`. */
export function toAbsolute(root: string, repoPath: string): string {
  return repoPath === ROOT ? root : path.join(root, ...repoPath.split('/'));
}

/** Sorts and deduplicates repository-relative paths, by code unit so the order is locale-independent. */
export function sortedUnique(paths: Iterable<string>): string[] {
  return [...new Set(paths)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
