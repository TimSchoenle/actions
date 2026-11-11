import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as core from 'actions-util/core';
import {
  buildPathspecs,
  describePatch,
  GitCommandError,
  METADATA_FILE_NAME,
  PATCH_FILE_NAME,
  runGit,
  runGitText,
  serializeMetadata,
} from 'actions-util/patch';

import type { PatchMetadata } from 'actions-util/patch';

/** Everything {@link createPatch} needs to know, read from the inputs and the runner. */
export interface CreatePatchRequest {
  /** The checked-out repository. */
  workspace: string;
  /** Existing, empty directory the patch and metadata are written to. */
  outputDirectory: string;
  /** Scratch directory for the throwaway index; removed before returning. */
  scratchRoot: string;
  /** Space- or newline-separated pathspecs, as `commit-changes` takes them. */
  paths: string;
  /** Largest patch, in bytes, before the step fails. */
  maxPatchBytes: number;
}

/** Raised when the patch would be larger than the configured limit. */
export class PatchTooLargeError extends Error {
  constructor(limit: number) {
    super(
      `The patch exceeds max_patch_bytes (${limit} bytes). Narrow paths, or raise max_patch_bytes on both ` +
        'create-patch and commit-patch.',
    );
    this.name = 'PatchTooLargeError';
  }
}

/**
 * The fixed flags of the diff that becomes the patch.
 *
 * Each one pins a behaviour that repository or user configuration could otherwise change, because
 * `commit-patch` applies the result with `git apply` and needs one exact format:
 *
 * - `--binary` and `--full-index` keep binary changes applicable instead of "Binary files differ".
 * - `--no-renames` makes every rename a deletion plus an addition, so each path is validated on its
 *   own and no rename similarity heuristic decides what the other side sees.
 * - `--no-ext-diff`, `--no-textconv`, `--no-color` and `--no-relative` turn off the `diff.*` settings
 *   that would replace or decorate the patch text.
 * - Explicit prefixes override `diff.noprefix` and `diff.mnemonicPrefix`; `git apply` strips one
 *   leading directory and needs it to be there.
 *
 * `.gitattributes` is neutralised separately, by {@link attrSourceFlag}.
 */
const DIFF_FLAGS = [
  'diff',
  '--cached',
  '--binary',
  '--full-index',
  '--no-renames',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--no-relative',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];

/** The empty tree's object name in a SHA-1 repository. */
const EMPTY_TREE_SHA1 = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** The empty tree's object name in a SHA-256 repository, whose object names are 64 digits. */
const EMPTY_TREE_SHA256 = '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321';

/**
 * The global flag that makes the diff read attributes from the empty tree instead of `.gitattributes`.
 *
 * A text file marked `-diff` or `binary` (a lockfile hidden from review diffs, say) would otherwise
 * be written as a `GIT binary patch`, and `commit-patch` refuses that as binary content. With no
 * attributes, git falls back to its content check, so a file is binary in the patch exactly when its
 * bytes are, which is the same test `commit-patch` applies to the result.
 */
function attrSourceFlag(baseSha: string): string {
  return `--attr-source=${baseSha.length === EMPTY_TREE_SHA256.length ? EMPTY_TREE_SHA256 : EMPTY_TREE_SHA1}`;
}

/** The first git release with the global `--attr-source` option, as `[major, minor]`. */
const ATTR_SOURCE_SINCE: readonly [number, number] = [2, 42];

/** Whether a `git version` line names a release that has `--attr-source`. */
export function supportsAttrSource(versionLine: string): boolean {
  const match = /(\d+)\.(\d+)/.exec(versionLine);
  if (match === null) {
    return false;
  }
  const [major, minor] = [Number(match[1]), Number(match[2])];

  return major > ATTR_SOURCE_SINCE[0] || (major === ATTR_SOURCE_SINCE[0] && minor >= ATTR_SOURCE_SINCE[1]);
}

/** A pathspec with `attr` magic, e.g. `:(attr:generated)` or `:(glob,attr:-vendored)src/**`. */
const ATTR_MAGIC = /^:\([^)]*\battr:/;

/**
 * The paths the diff selects, resolved against the repository's own `.gitattributes`.
 *
 * Run only when a pathspec uses `attr` magic: the patch diff reads attributes from the empty tree, so
 * such a pathspec would match nothing there and silently drop the changes it names.
 */
async function resolveAttrSelection(
  baseSha: string,
  specs: readonly string[],
  options: { cwd: string; env: Record<string, string> },
): Promise<string[]> {
  const names = await runGit(
    ['diff', '--cached', '--name-only', '-z', '--no-renames', baseSha, '--', ...specs],
    options,
  );

  return names
    .toString('utf8')
    .split('\0')
    .filter((name) => name !== '')
    .map((name) => `:(top,literal)${name}`);
}

/**
 * Computes the patch of the working tree against `HEAD` and writes it, with its metadata, to
 * `outputDirectory`.
 *
 * The working tree is staged into a throwaway index, never the checkout's own, so a caller's later
 * steps see the repository exactly as the formatter or generator left it. Staging is what brings
 * untracked files into the diff; `.gitignore` still applies, so build caches and `node_modules` stay
 * out. `core.fileMode` is off for the staging, the same as `commit-changes` does it: the GraphQL commit
 * API cannot record a mode change, and a checkout that flipped an executable bit would otherwise
 * produce a patch `commit-patch` has to refuse.
 *
 * The whole tree is staged and the diff is then scoped to the pathspecs, rather than staging only the
 * pathspecs: `git add` fails on a pathspec that matches nothing, and an optional generated directory
 * that does not exist yet is a normal state, not an error.
 *
 * @throws {PatchTooLargeError} when the patch exceeds `maxPatchBytes`.
 */
export async function createPatch(request: CreatePatchRequest): Promise<PatchMetadata> {
  const { maxPatchBytes, outputDirectory, scratchRoot, workspace } = request;

  // `--verify` prints the full object name or fails, so its output needs no shape check here; and
  // commit-patch revalidates base_sha when it parses the metadata, whatever this job wrote.
  const baseSha = await runGitText(['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], { cwd: workspace });

  const scratch = await mkdtemp(path.join(scratchRoot, 'create-patch-'));
  const env = { GIT_INDEX_FILE: path.join(scratch, 'index') };

  let patch: Buffer;
  try {
    await runGit(['read-tree', baseSha], { cwd: workspace, env });
    await runGit(['-c', 'core.fileMode=false', 'add', '--all'], { cwd: workspace, env });

    const { specs, useFilter } = buildPathspecs(request.paths);
    const attrSource = supportsAttrSource(await runGitText(['version'], { cwd: workspace }));
    if (!attrSource) {
      core.warning(
        'git is older than 2.42, so the patch follows .gitattributes: a text file marked -diff or binary is ' +
          'written as a binary patch, which commit-patch refuses unless allow_binary is set. Upgrade git on ' +
          'the runner to lift this.',
      );
    }

    let selection = useFilter ? specs : [];
    if (attrSource && selection.some((spec) => ATTR_MAGIC.test(spec))) {
      selection = await resolveAttrSelection(baseSha, selection, { cwd: workspace, env });
    }

    // An attr-magic selection that matched nothing must not fall through to an unscoped diff.
    patch =
      useFilter && selection.length === 0
        ? Buffer.alloc(0)
        : await runGit([...(attrSource ? [attrSourceFlag(baseSha)] : []), ...DIFF_FLAGS, baseSha, '--', ...selection], {
            cwd: workspace,
            env,
            maxOutputBytes: maxPatchBytes,
          });
  } catch (error) {
    if (error instanceof GitCommandError && error.outputLimitExceeded) {
      throw new PatchTooLargeError(maxPatchBytes);
    }
    throw error;
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }

  const metadata = describePatch(baseSha, patch);

  await writeFile(path.join(outputDirectory, PATCH_FILE_NAME), patch, { flag: 'wx' });
  await writeFile(path.join(outputDirectory, METADATA_FILE_NAME), serializeMetadata(metadata), { flag: 'wx' });

  return metadata;
}
