/**
 * The sources a bundle is built from, and the inverse: which actions a change affects.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';

import { buildSet } from './build-set.js';
import { findActions } from './discover.js';
import { isWithin, joinRepoPath, ROOT, sortedUnique, toAbsolute, toRepoPath } from './paths.js';

/**
 * Lockfiles of the package managers a build may run, at the repository root. Whichever exist count as
 * build inputs: a lockfile change can change a bundled dependency without touching any source file.
 */
export const LOCKFILES: readonly string[] = [
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];

/**
 * Toolchain pins at the repository root. Whichever exist count as build inputs: a different bundler
 * or runtime version can produce different bytes from the same sources.
 */
export const TOOLCHAIN_FILES: readonly string[] = ['.bun-version', '.node-version', '.nvmrc', '.tool-versions'];

/**
 * Build configuration at the repository root. Whichever exist count as build inputs: the bundler
 * resolves `actions-util/*` through the `paths` of the root `tsconfig.json`, because the package's
 * `exports` point at a `dist/` that a checkout does not have, so a change there can change every bundle.
 */
export const BUILD_CONFIG_FILES: readonly string[] = ['tsconfig.json'];

/**
 * The fields of a `package.json` whose workspace dependencies can end up in a bundle.
 * `devDependencies` are left out: every action lists the test harness there, and a harness change
 * does not change a bundle. A workspace package a build runs as a tool belongs in `dependencies`.
 */
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

interface PackageJson {
  readonly name?: unknown;
  readonly [field: string]: unknown;
}

/** @throws an `Error` naming the repository-relative file when it is not valid JSON */
function readPackageJson(root: string, directory: string): PackageJson | undefined {
  const repoPath = joinRepoPath(directory, 'package.json');
  const file = toAbsolute(root, repoPath);
  if (!fs.existsSync(file)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJson;
  } catch (error) {
    throw new Error(`${repoPath}: not valid JSON: ${(error as Error).message}`, { cause: error });
  }
}

/** The names a `package.json` depends on through the `workspace:` protocol. */
function workspaceDependencies(pkg: PackageJson): string[] {
  const names: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = pkg[field];
    if (typeof deps !== 'object' || deps === null) {
      continue;
    }
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) {
        names.push(name);
      }
    }
  }

  return names;
}

/**
 * Every workspace package of the repository by name, mapped to its directory.
 *
 * Found by walking for `package.json` files rather than by expanding the root `workspaces` globs, so
 * the result does not depend on one package manager's glob dialect. A name declared twice keeps the
 * first directory in sorted order; package managers reject that layout anyway.
 */
export function workspacePackages(root: string): Map<string, string> {
  const packages = new Map<string, string>();
  const pending = [ROOT];
  const directories: string[] = [];

  while (pending.length > 0) {
    const directory = pending.pop() as string;
    for (const entry of fs.readdirSync(toAbsolute(root, directory), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
        pending.push(joinRepoPath(directory, entry.name));
      } else if (entry.isFile() && entry.name === 'package.json' && directory !== ROOT) {
        directories.push(directory);
      }
    }
  }

  for (const directory of sortedUnique(directories)) {
    const name = readPackageJson(root, directory)?.name;
    if (typeof name === 'string' && !packages.has(name)) {
      packages.set(name, directory);
    }
  }

  return packages;
}

/** Root files of {@link LOCKFILES}, {@link TOOLCHAIN_FILES} and {@link BUILD_CONFIG_FILES} that exist. */
export function rootBuildInputs(root: string): string[] {
  return [...LOCKFILES, ...TOOLCHAIN_FILES, ...BUILD_CONFIG_FILES].filter((file) =>
    fs.existsSync(toAbsolute(root, file)),
  );
}

/**
 * The repository paths whose change can change the bundles of `actionDirectories`.
 *
 * Each action directory, the directory of every workspace package its `package.json` reaches through
 * `workspace:` dependencies (transitively), and the root lockfile, toolchain pins and build configuration. Directories are
 * returned as they are; turn them into globs where a glob is needed.
 *
 * @param root - absolute path of the repository root
 * @param actionDirectories - repository-relative directories, typically a build set's `buildDirs`
 * @param packages - the result of {@link workspacePackages}, passed in when called repeatedly
 */
export function sourceInputs(
  root: string,
  actionDirectories: Iterable<string>,
  packages: ReadonlyMap<string, string> = workspacePackages(root),
): string[] {
  const inputs = new Set<string>(rootBuildInputs(root));
  const pending = [...actionDirectories].map((directory) => toRepoPath(directory, 'action directory'));
  const seen = new Set<string>();

  while (pending.length > 0) {
    const directory = pending.pop() as string;
    if (seen.has(directory)) {
      continue;
    }
    seen.add(directory);
    inputs.add(directory);

    const pkg = readPackageJson(root, directory);
    for (const name of pkg === undefined ? [] : workspaceDependencies(pkg)) {
      const dependency = packages.get(name);
      if (dependency !== undefined) {
        pending.push(dependency);
      }
    }
  }

  return sortedUnique(inputs);
}

/**
 * The actions among `candidates` that a change to `changedFiles` affects: a changed file lies in an
 * action directory of the candidate's build set, or among the {@link sourceInputs} of its build
 * directories. A candidate that builds nothing is not affected by a lockfile or toolchain change.
 *
 * @param root - absolute path of the repository root
 * @param changedFiles - repository-relative paths
 * @param candidates - action directories to consider; every action of the repository by default
 */
export function affected(
  root: string,
  changedFiles: Iterable<string>,
  candidates: Iterable<string> = findActions(root),
): string[] {
  const changed = [...changedFiles].map((file) => toRepoPath(file, 'changed file'));
  const packages = workspacePackages(root);

  const hits = [...candidates].filter((candidate) => {
    const set = buildSet(root, [candidate]);
    const inputs = [...set.actions, ...(set.buildDirs.length === 0 ? [] : sourceInputs(root, set.buildDirs, packages))];

    return changed.some((file) => inputs.some((input) => isWithin(input, file)));
  });

  return sortedUnique(hits);
}
