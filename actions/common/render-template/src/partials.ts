import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { PartialsDirectoryNotFoundError } from './errors.js';
import { readTemplateSource } from './template-file.js';

/** The one extension a partial file may carry. A single convention beats a list to remember. */
export const PARTIAL_EXTENSION = '.hbs';

/** A reusable template fragment, addressable from a template as `{{> name }}`. */
export interface PartialTemplate {
  /** Path relative to the partials directory, POSIX-separated and without the extension. */
  name: string;
  /** Path on disk, for error reporting. */
  path: string;
  source: string;
}

/** Collects every partial file under `directory`, depth-first, with paths relative to `root`. */
async function collect(root: string, directory: string, found: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  // Sorted here rather than at the end: registration order decides nothing on its own, but a stable
  // order makes the reported list — and any duplicate-name collision — reproducible.
  for (const entry of entries.toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await collect(root, entryPath, found);
    } else if (entry.isFile() && entry.name.endsWith(PARTIAL_EXTENSION)) {
      found.push(entryPath);
    }
  }
}

/**
 * Derives the name a partial is addressed by from its location.
 *
 * Nesting is preserved (`tables/actions.hbs` becomes `tables/actions`) so a partials directory can be
 * organized without the names collapsing into one flat namespace, and the separator is normalized to
 * `/` so the same template renders on a Windows checkout.
 */
export function partialName(root: string, filePath: string): string {
  const relative = path.relative(root, filePath).replaceAll('\\', '/');

  return relative.slice(0, -PARTIAL_EXTENSION.length);
}

/**
 * Loads every `.hbs` partial under a directory, recursively.
 *
 * An empty path means the caller declared no partials, which is not the same as an empty directory
 * and is not an error. A path that was declared but does not resolve to a directory is: it is a typo
 * in the workflow, and rendering on without the partials would fail later with a far less useful
 * message — or, worse, succeed against a stale output.
 *
 * @throws {PartialsDirectoryNotFoundError} if a non-empty path is not a readable directory.
 * @throws {TemplateNotFoundError} if a discovered partial cannot be read.
 */
export async function loadPartials(directory: string): Promise<PartialTemplate[]> {
  const root = directory.trim();
  if (root === '') {
    return [];
  }

  try {
    if (!(await stat(root)).isDirectory()) {
      throw new PartialsDirectoryNotFoundError(root);
    }
  } catch (error) {
    throw error instanceof PartialsDirectoryNotFoundError ? error : new PartialsDirectoryNotFoundError(root, error);
  }

  const files: string[] = [];
  await collect(root, root, files);

  return Promise.all(
    files.map(async (filePath) => ({
      name: partialName(root, filePath),
      path: filePath,
      source: await readTemplateSource(filePath),
    })),
  );
}
