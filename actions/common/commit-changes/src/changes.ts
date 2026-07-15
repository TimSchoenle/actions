/** A single file added or updated by the commit, with its working-tree content. */
export interface FileAddition {
  /** Repository-relative path, as git reports it. */
  path: string;
  /** Base64-encoded working-tree content, as the GraphQL commit API requires. */
  contents: string;
}

/** A single file removed by the commit. */
export interface FileDeletion {
  /** Repository-relative path, as git reports it. */
  path: string;
}

/** The additions and deletions of one commit, in the shape `createCommitOnBranch` expects. */
export interface FileChanges {
  additions: FileAddition[];
  deletions: FileDeletion[];
}

/**
 * Reads the working-tree files a commit needs, kept minimal so the classification is testable without
 * touching the filesystem.
 */
export interface WorkspaceReader {
  /** Whether the path still exists in the working tree. */
  exists(path: string): boolean;
  /** The base64-encoded content of the working-tree file at the path. */
  readBase64(path: string): string;
}

/**
 * Parses the output of `git status --porcelain -z -uall --no-renames` into the changed paths.
 *
 * `--no-renames` is what keeps this parser simple: a rename is reported as a deletion of the old path
 * and an addition of the new one, so every record is a single `XY <path>` field and never the
 * two-path form whose NUL ordering differs between git versions. `-z` terminates each record with a
 * NUL, so a path containing a space or a newline survives intact — which the non-`-z` format, meant
 * for humans, does not guarantee.
 *
 * The two status characters and their trailing space are dropped; only the path is kept, because the
 * add-versus-delete decision is made from the working tree in {@link classifyChanges}, not from the
 * status codes.
 */
export function parseChangedPaths(statusOutput: string): string[] {
  const seen = new Set<string>();

  for (const record of statusOutput.split('\0')) {
    // A well-formed record is `XY <path>`: two status characters, a separator, then the path.
    if (record.length < 4) {
      continue;
    }

    const path = record.slice(3);
    if (path !== '') {
      seen.add(path);
    }
  }

  return [...seen];
}

/**
 * Splits the changed paths into additions and deletions by consulting the working tree.
 *
 * A path still present on disk is an addition carrying its current content; a path that is gone is a
 * deletion. Deciding from the working tree rather than from git's status codes means a staged-then-
 * deleted file, or the new and old halves of a rename, each land on the correct side without having
 * to interpret every combination of index and worktree states.
 */
export function classifyChanges(paths: readonly string[], workspace: WorkspaceReader): FileChanges {
  const additions: FileAddition[] = [];
  const deletions: FileDeletion[] = [];

  for (const path of paths) {
    if (workspace.exists(path)) {
      additions.push({ contents: workspace.readBase64(path), path });
    } else {
      deletions.push({ path });
    }
  }

  return { additions, deletions };
}
