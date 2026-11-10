/**
 * Content digests: SHA-256 for the bundle manifest, and git's object ids for the Git Data API.
 *
 * @packageDocumentation
 */
import { createHash } from 'node:crypto';

/** Lowercase hexadecimal SHA-256 of `content`. */
export function sha256Hex(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Whether `value` is a lowercase hexadecimal SHA-256 digest. */
export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** Whether `value` is a full lowercase hexadecimal SHA-1 object id, as git and the GitHub API print one. */
export function isGitObjectId(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

/** git's object id of `body` stored as an object of `type`: SHA-1 of `<type> <size>\0<body>`. */
function gitObjectId(type: 'blob' | 'tree', body: Uint8Array): string {
  return createHash('sha1').update(`${type} ${body.byteLength}\0`).update(body).digest('hex');
}

/** git's object id of a file with this content: what `git hash-object` prints and the Git Data API returns. */
export function gitBlobId(content: Uint8Array): string {
  return gitObjectId('blob', content);
}

/** File modes git records in a tree. */
export type GitTreeMode = '100644' | '100755' | '120000' | '040000' | '160000';

/** One entry of a git tree object. */
export interface GitTreeEntry {
  readonly name: string;
  readonly mode: GitTreeMode;
  readonly sha: string;
}

/**
 * git's sort key for a tree entry: the name, with a `/` appended for a subtree, compared by bytes.
 * Without the `/` a directory `a` and a file `a.txt` would sort the wrong way round.
 */
function treeSortKey(entry: GitTreeEntry): Buffer {
  return Buffer.from(entry.mode === '040000' ? `${entry.name}/` : entry.name, 'utf8');
}

/**
 * git's object id of a tree with these entries, computed locally.
 *
 * Lets a caller know the id of a tree before asking GitHub to create it, and check the id GitHub
 * returns against it. A subtree's mode is written as `40000`, without the leading zero, as git does.
 */
export function gitTreeId(entries: readonly GitTreeEntry[]): string {
  const sorted = [...entries].sort((a, b) => Buffer.compare(treeSortKey(a), treeSortKey(b)));
  const parts = sorted.map((entry) =>
    Buffer.concat([
      Buffer.from(`${entry.mode === '040000' ? '40000' : entry.mode} ${entry.name}\0`, 'utf8'),
      Buffer.from(entry.sha, 'hex'),
    ]),
  );

  return gitObjectId('tree', Buffer.concat(parts));
}
