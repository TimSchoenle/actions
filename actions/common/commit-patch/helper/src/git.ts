import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { runGit, runGitText } from 'actions-util/patch';

import { parseRawDiff } from './raw-diff.js';

import type { RawChange } from './raw-diff.js';

/** The git operations `commit-patch` needs, kept minimal so the orchestration is testable with fakes. */
export interface PatchGit {
  /** The commit `HEAD` of the checkout points at. */
  headSha(): Promise<string>;
  /** Paths whose hunks in the patch are binary, as `git apply --numstat` reports them. */
  binaryPathsInPatch(patchPath: string): Promise<Set<string>>;
  /**
   * Applies the patch to a throwaway index holding `baseSha`, and reports every path that differs
   * from `baseSha` afterwards. The checkout's own index and working tree are never written.
   *
   * @throws when the patch does not apply cleanly.
   */
  applyToScratchIndex(baseSha: string, patchPath: string): Promise<RawChange[]>;
  /** The symbolic links and submodules of `baseSha`'s tree, by path, with their mode. */
  linksInTree(baseSha: string): Promise<Map<string, string>>;
  /** The raw bytes of a blob. */
  readBlob(sha: string): Promise<Buffer>;
}

/** Modes that make a tree entry a symbolic link or a submodule. */
const LINK_MODES = new Set(['120000', '160000']);

/** Largest blob read back for the commit. Above this the GraphQL request would be refused anyway. */
const MAX_BLOB_BYTES = 100 * 1024 * 1024;

/** Largest `ls-tree` listing read; a repository with more is outside what this action is for. */
const MAX_TREE_LISTING_BYTES = 256 * 1024 * 1024;

/**
 * Parses `git ls-tree -r -z` output, keeping only the symbolic links and submodules.
 *
 * Each record is `<mode> SP <type> SP <object> TAB <path>`, NUL-terminated, so a path with any
 * character but NUL survives intact.
 */
export function parseTreeLinks(output: string): Map<string, string> {
  const links = new Map<string, string>();

  for (const record of output.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab === -1) {
      continue;
    }

    const mode = record.slice(0, record.indexOf(' '));
    if (LINK_MODES.has(mode)) {
      links.set(record.slice(tab + 1), mode);
    }
  }

  return links;
}

/**
 * Parses `git apply --numstat -z` output into the paths of binary hunks.
 *
 * A text hunk reports `<added> TAB <deleted> TAB <path>`; a binary one reports `-` for both counts. A
 * rename or copy reports an empty path followed by the old and new paths as two further fields, and
 * both are returned so neither half of a binary rename slips past the check.
 */
export function parseBinaryNumstat(output: string): Set<string> {
  const fields = output.split('\0');
  const binary = new Set<string>();

  for (let index = 0; index < fields.length; index++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[index]);
    if (!match) {
      continue;
    }

    const [, added, deleted, name] = match;
    const paths = name === '' ? fields.slice(index + 1, index + 3) : [name];
    if (name === '') {
      index += 2;
    }

    if (added === '-' && deleted === '-') {
      for (const entry of paths) {
        binary.add(entry);
      }
    }
  }

  return binary;
}

/**
 * Binds {@link PatchGit} to the `git` executable, run in `workspace`.
 *
 * Nothing here executes content from the repository: `apply`, `read-tree`, `diff-index`, `ls-tree`
 * and `cat-file` are plumbing that reads objects and never runs hooks, filters or diff drivers.
 *
 * @param scratchRoot where the throwaway index is created; it is removed after each use.
 */
export function createPatchGit(workspace: string, scratchRoot: string): PatchGit {
  const options = { cwd: workspace };

  return {
    async applyToScratchIndex(baseSha: string, patchPath: string): Promise<RawChange[]> {
      const scratch = await mkdtemp(path.join(scratchRoot, 'commit-patch-index-'));
      const env = { GIT_INDEX_FILE: path.join(scratch, 'index') };

      try {
        await runGit(['read-tree', baseSha], { ...options, env });
        await runGit(['apply', '--cached', '--whitespace=nowarn', patchPath], { ...options, env });

        const raw = await runGit(['diff-index', '--cached', '--raw', '-z', '--no-renames', '--no-abbrev', baseSha], {
          ...options,
          env,
        });

        return parseRawDiff(raw.toString('utf8'));
      } finally {
        await rm(scratch, { force: true, recursive: true });
      }
    },

    async binaryPathsInPatch(patchPath: string): Promise<Set<string>> {
      const output = await runGit(['apply', '--numstat', '-z', patchPath], options);

      return parseBinaryNumstat(output.toString('utf8'));
    },

    headSha(): Promise<string> {
      return runGitText(['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], options);
    },

    async linksInTree(baseSha: string): Promise<Map<string, string>> {
      const output = await runGit(['ls-tree', '-r', '-z', '--full-tree', baseSha], {
        ...options,
        maxOutputBytes: MAX_TREE_LISTING_BYTES,
      });

      return parseTreeLinks(output.toString('utf8'));
    },

    readBlob(sha: string): Promise<Buffer> {
      return runGit(['cat-file', 'blob', sha], { ...options, maxOutputBytes: MAX_BLOB_BYTES });
    },
  };
}
