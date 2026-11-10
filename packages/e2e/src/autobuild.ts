/**
 * Rebuilds stale bundles before a local end-to-end run, so a developer never tests a bundle older
 * than the sources next to it. CI never does this: there the cases run the bundles the verify
 * workflow built and installed, and `assertBuiltBundle` checks each one.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { findActions, readActionManifest, sourceInputs, toAbsolute, workspacePackages } from 'action-graph';

/** Directory names whose files are build outputs or dependencies, not sources. */
const NOT_SOURCES = new Set(['node_modules', 'dist', '.git']);

/** The newest modification time of any source file at or below `repoPath`, cached per path. */
function newestSource(root: string, repoPath: string, cache: Map<string, number>): number {
  const known = cache.get(repoPath);
  if (known !== undefined) {
    return known;
  }

  let newest = 0;
  const pending = [toAbsolute(root, repoPath)];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    const stats = fs.statSync(current);
    if (stats.isFile()) {
      newest = Math.max(newest, stats.mtimeMs);
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!NOT_SOURCES.has(entry.name) && (entry.isDirectory() || entry.isFile())) {
        pending.push(path.join(current, entry.name));
      }
    }
  }
  cache.set(repoPath, newest);

  return newest;
}

/**
 * The build directories under `actions/` whose bundles are missing or older than any of their
 * sources: the action directory, its workspace dependencies, the lockfile and the toolchain pins.
 *
 * @param root - absolute path of the repository root
 */
export function staleBuildDirs(root: string): string[] {
  const packages = workspacePackages(root);
  const cache = new Map<string, number>();

  return findActions(root, { within: 'actions' }).filter((directory) => {
    const bundles = readActionManifest(root, directory).bundles.map((bundle) => toAbsolute(root, bundle));
    if (bundles.length === 0) {
      return false;
    }
    if (bundles.some((bundle) => !fs.existsSync(bundle))) {
      return true;
    }
    const built = Math.min(...bundles.map((bundle) => fs.statSync(bundle).mtimeMs));

    return sourceInputs(root, [directory], packages).some((input) => newestSource(root, input, cache) > built);
  });
}

/**
 * Rebuilds every stale bundle with `bun run build:actions`, the same build CI runs.
 *
 * @returns the directories rebuilt
 * @throws an `Error` when the build fails
 */
export function rebuildStaleBundles(root: string): string[] {
  const stale = staleBuildDirs(root);
  if (stale.length === 0) {
    return [];
  }

  const result = spawnSync('bun', ['run', 'build:actions', ...stale], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Rebuilding stale bundles failed (${result.error?.message ?? `exit code ${result.status}`}).`);
  }

  return stale;
}
