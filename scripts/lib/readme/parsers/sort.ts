import type { DocumentationItem } from '../types.js';

/**
 * Orders parsed items independently of the order the filesystem handed them over in.
 *
 * A directory read yields in filesystem order, which differs between Windows and Linux. That order
 * reaches a committed file, so an unsorted parser makes the `update-readme` job push the same rows
 * back and forth on every run and adds churn to any PR whose author regenerates docs locally.
 *
 * `name` is the first column of every generated table, so it is the primary key. `path` breaks ties:
 * two items may legitimately share a name, and leaving a tie to the input order would put the
 * nondeterminism straight back.
 */
export function sortDocumentationItems(items: DocumentationItem[]): DocumentationItem[] {
  return items.toSorted((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
