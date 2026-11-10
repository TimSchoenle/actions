/**
 * The build set of an action: every bundle that has to exist for the action to run from a checkout.
 *
 * Three rules, applied transitively:
 *
 * 1. A JavaScript action needs its own bundles (`runs.pre`, `runs.main`, `runs.post`).
 * 2. A composite action needs every nested action its `run:` steps invoke through the action path,
 *    such as `node "$GITHUB_ACTION_PATH/helper/dist/index.js"`. That is how a composite runs a
 *    TypeScript helper it never names in a `uses:`.
 * 3. A composite action needs every action it names with `uses: ./<path>`.
 *
 * A remote reference (`owner/repo/path@sha`) is a leaf. The runner downloads it with whatever bundle
 * its ref carries, so building the local copy would test a combination that is never shipped.
 *
 * @packageDocumentation
 */
import { findManifestFile, readActionManifest } from './manifest.js';
import { isWithin, joinRepoPath, parentOf, sortedUnique, toRepoPath } from './paths.js';

import type { ActionManifest } from './manifest.js';

/** Whether `directory` lies below `ancestor`, excluding `ancestor` itself. */
function isStrictlyBelow(ancestor: string, directory: string): boolean {
  return directory !== ancestor && isWithin(ancestor, directory);
}

/** What has to be built for a set of actions to run. All paths are repository-relative and sorted. */
export interface BuildSet {
  /** Every action directory in the closure, built or not. */
  readonly actions: readonly string[];
  /** The directories of the JavaScript actions in the closure: where a build runs. */
  readonly buildDirs: readonly string[];
  /** Every bundle file the closure executes. */
  readonly bundles: readonly string[];
}

/**
 * Matches a path appended to the action directory in a shell script: `$GITHUB_ACTION_PATH/x`,
 * `${GITHUB_ACTION_PATH}/x` or `${{ github.action_path }}/x`. The capture ends at whitespace or at a
 * character that ends a word in shell.
 */
const ACTION_PATH_REFERENCE =
  /(?:\$\{?GITHUB_ACTION_PATH\}?|\$\{\{\s*github\.action_path\s*\}\})\/([^\s"'`;&|()<>$]+)/g;

/**
 * The nested actions a composite invokes through its own directory, found in its `run:` scripts.
 *
 * For each referenced file the deepest enclosing directory below the action that holds a manifest is
 * the nested action: `helper/dist/index.js` resolves to `helper` when `helper/action.yaml` exists. A
 * reference to a plain file of the action itself, such as a shell script, names no nested action.
 *
 * @param root - absolute path of the repository root
 * @param manifest - the composite action's manifest
 */
export function invokedNestedActions(root: string, manifest: ActionManifest): string[] {
  const nested: string[] = [];

  for (const script of manifest.runScripts) {
    for (const match of script.matchAll(ACTION_PATH_REFERENCE)) {
      let candidate: string;
      try {
        candidate = joinRepoPath(manifest.directory, toRepoPath(match[1]));
      } catch {
        // A reference with a `..` segment or an expansion is not a path below the action.
        continue;
      }

      for (let directory = parentOf(candidate); isStrictlyBelow(manifest.directory, directory);) {
        if (findManifestFile(root, directory) !== undefined) {
          nested.push(directory);
          break;
        }
        directory = parentOf(directory);
      }
    }
  }

  return sortedUnique(nested);
}

/**
 * The build set of `targets`, following the three rules in the module comment.
 *
 * @param root - absolute path of the repository root
 * @param targets - repository-relative action directories
 * @throws {@link ManifestError} when a target, or an action the closure reaches, has no valid manifest
 */
export function buildSet(root: string, targets: Iterable<string>): BuildSet {
  const visited = new Set<string>();
  const buildDirs: string[] = [];
  const bundles: string[] = [];
  const pending = [...targets].map((target) => toRepoPath(target, 'action directory'));

  while (pending.length > 0) {
    const directory = pending.pop() as string;
    if (visited.has(directory)) {
      continue;
    }
    visited.add(directory);

    const manifest = readActionManifest(root, directory);
    if (manifest.bundles.length > 0) {
      buildDirs.push(directory);
      bundles.push(...manifest.bundles);
    }
    pending.push(...manifest.localUses, ...invokedNestedActions(root, manifest));
  }

  return {
    actions: sortedUnique(visited),
    buildDirs: sortedUnique(buildDirs),
    bundles: sortedUnique(bundles),
  };
}

/** Merges build sets, as the build set of the union of their targets. */
export function mergeBuildSets(sets: Iterable<BuildSet>): BuildSet {
  const all = [...sets];

  return {
    actions: sortedUnique(all.flatMap((set) => set.actions)),
    buildDirs: sortedUnique(all.flatMap((set) => set.buildDirs)),
    bundles: sortedUnique(all.flatMap((set) => set.bundles)),
  };
}
