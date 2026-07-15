import { existsSync, readFileSync } from 'node:fs';

import type { WorkspaceReader } from './changes.js';

/**
 * Binds {@link WorkspaceReader} to the real filesystem, rooted at the process working directory —
 * which the runner sets to the checked-out repository, the same root git reports paths relative to.
 *
 * Content is read as raw bytes and base64-encoded, so a binary file survives the round-trip through
 * the GraphQL commit API unchanged.
 */
export function createWorkspace(): WorkspaceReader {
  return {
    exists(path: string): boolean {
      return existsSync(path);
    },

    readBase64(path: string): string {
      return readFileSync(path).toString('base64');
    },
  };
}
