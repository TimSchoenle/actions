/**
 * Discovery of action directories by walking the repository.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';

import { MANIFEST_FILE_NAMES } from './manifest.js';
import { joinRepoPath, ROOT, sortedUnique, toAbsolute, toRepoPath } from './paths.js';

/** Directory names never descended into: dependency trees and git metadata hold no action of the repository. */
export const DEFAULT_EXCLUDED_DIRECTORY_NAMES: readonly string[] = ['node_modules', '.git'];

export interface FindActionsOptions {
  /** Repository-relative directory to search below. Defaults to the whole repository. */
  readonly within?: string;
  /** Directory names skipped wherever they occur. Defaults to {@link DEFAULT_EXCLUDED_DIRECTORY_NAMES}. */
  readonly excludedNames?: readonly string[];
  /** Repository-relative directories skipped together with everything below them. */
  readonly excludedDirectories?: readonly string[];
}

/**
 * Every directory holding an action manifest, sorted.
 *
 * Symbolic links are not followed, so a link cannot make the walk leave the repository or loop. The
 * manifests are not parsed here: discovery has to succeed on a tree that contains a template or a
 * fixture that is not a valid action.
 *
 * @param root - absolute path of the repository root
 */
export function findActions(root: string, options: FindActionsOptions = {}): string[] {
  const excludedNames = new Set(options.excludedNames ?? DEFAULT_EXCLUDED_DIRECTORY_NAMES);
  const excludedDirectories = new Set((options.excludedDirectories ?? []).map((dir) => toRepoPath(dir)));
  const found: string[] = [];
  const pending = [toRepoPath(options.within ?? ROOT, 'search directory')];

  while (pending.length > 0) {
    const directory = pending.pop() as string;
    if (excludedDirectories.has(directory)) {
      continue;
    }

    const entries = fs.readdirSync(toAbsolute(root, directory), { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && (MANIFEST_FILE_NAMES as readonly string[]).includes(entry.name))) {
      found.push(directory);
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !excludedNames.has(entry.name)) {
        pending.push(joinRepoPath(directory, entry.name));
      }
    }
  }

  return sortedUnique(found);
}
