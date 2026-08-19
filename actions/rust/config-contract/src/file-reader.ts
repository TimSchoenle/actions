/**
 * Reading a file whose absence is an answer rather than an error.
 *
 * Three of the four checks ask "is the right thing at this path", so a missing file is a verdict
 * they report, not an exception they propagate. Anything else — a permission error, a read fault —
 * is left to propagate, because it means the check did not run and an unrun check must not be
 * reported as a clean one.
 */
import { readFile, stat } from 'node:fs/promises';

import type { FileReader } from './checks.js';

/** Error codes that mean "nothing readable is at this path", as opposed to "the read failed". */
const ABSENT = new Set(['ENOENT', 'ENOTDIR', 'EISDIR']);

/** Binds {@link FileReader} to the filesystem. */
export function createFileReader(): FileReader {
  return async (absolutePath: string): Promise<string | undefined> => {
    try {
      return await readFile(absolutePath, 'utf8');
    } catch (error) {
      if (ABSENT.has((error as NodeJS.ErrnoException).code ?? '')) {
        return undefined;
      }

      throw error;
    }
  };
}

/**
 * Whether a path is a directory the step can run a command in.
 *
 * Asked before the generator runs, so a mistyped `source_directory` is reported as the input it is
 * rather than as whatever `@actions/exec` says about a working directory it could not enter. A
 * monorepo passes a path here on every call, and a renamed crate is the ordinary way to get it
 * wrong.
 */
export async function isDirectory(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isDirectory();
  } catch {
    return false;
  }
}
