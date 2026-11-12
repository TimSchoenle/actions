import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import type { WorkspaceReader } from './changes.js';

/**
 * Whether `child` is `root` or lies below it, on whole path segments. Both are absolute and real.
 */
function isWithin(root: string, child: string): boolean {
  const relative = path.relative(root, child);

  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** The `code` of a Node.js system error, or undefined for anything else. */
function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}

/**
 * Binds {@link WorkspaceReader} to the real filesystem, rooted at `root`: by default the process
 * working directory, which the runner sets to the checked-out repository, the same root git reports
 * paths relative to.
 *
 * Only regular files inside the root are committed. A symbolic link anywhere in a changed path, the
 * path itself or a directory above it, would otherwise be followed and the target's bytes committed as
 * an ordinary file: a link to `/proc/self/environ` put the step's environment, `INPUT_TOKEN` included,
 * into a public commit. Such a path, and any other entry that is not a regular file, fails the
 * action instead. The commit API cannot record a link or a directory anyway.
 *
 * Content is read as raw bytes and base64-encoded, so a binary file survives the round-trip through
 * the GraphQL commit API unchanged.
 */
export function createWorkspace(root: string = process.cwd()): WorkspaceReader {
  const realRoot = realpathSync(root);
  const resolve = (relativePath: string): string => path.resolve(realRoot, relativePath);

  return {
    exists(relativePath: string): boolean {
      const absolute = resolve(relativePath);
      let entry;
      try {
        entry = lstatSync(absolute);
      } catch (error) {
        // A directory above the path that is gone, or a file under one, is a deletion like any other.
        if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') {
          return false;
        }
        throw error;
      }

      if (!entry.isFile()) {
        throw new Error(
          `${JSON.stringify(relativePath)} is ${entry.isSymbolicLink() ? 'a symbolic link' : 'not a regular file'}; only regular files are committed.`,
        );
      }
      if (!isWithin(realRoot, realpathSync(absolute))) {
        throw new Error(
          `${JSON.stringify(relativePath)} resolves outside the working tree through a symbolic link in its directories; only files inside the working tree are committed.`,
        );
      }

      return true;
    },

    readBase64(relativePath: string): string {
      // O_NOFOLLOW refuses a link swapped in after exists() checked the path, and fstat on the open
      // descriptor checks the file that is actually read.
      const descriptor = openSync(resolve(relativePath), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!fstatSync(descriptor).isFile()) {
          throw new Error(`${JSON.stringify(relativePath)} is not a regular file; only regular files are committed.`);
        }
        return readFileSync(descriptor).toString('base64');
      } finally {
        closeSync(descriptor);
      }
    },
  };
}
