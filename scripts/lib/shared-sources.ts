import fs from 'node:fs';
import path from 'node:path';

import { joinRepoPath, sha256Hex, sourceInputs, toAbsolute, workspacePackages } from 'action-graph';

/**
 * Path of the generated shared-sources digest, relative to the action directory.
 *
 * It sits under `src/generated/`, which ESLint and oxfmt ignore. Because it lies inside the action's
 * directory, it also lies inside the action's release-please package.
 */
export const SHARED_SOURCES_PATH = 'src/generated/shared-sources.json';

/** The directory of a shared package whose files are hashed. Everything a bundle imports lives here. */
const SOURCE_DIR = 'src';

/** Directory names whose contents no bundle contains. */
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set(['__tests__', '__fixtures__', '__mocks__', 'node_modules']);

/** Test files by name, including the `.e2e.test.ts` and `.property.test.ts` variants. */
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** One hashed file, its path relative to the package directory. */
export interface SharedSourceFile {
  readonly path: string;
  readonly sha256: string;
}

/** A workspace package an action bundles, with the digest of every bundled source file in it. */
export interface SharedPackage {
  readonly name: string;
  /** Repository-relative directory of the package. */
  readonly directory: string;
  readonly files: readonly SharedSourceFile[];
}

/**
 * Whether a file under a shared package's `src/` can end up in a bundle.
 *
 * Tests, fixtures and mocks never do, so a change to them must not change the digest: that would
 * release every action that bundles the package for a change none of them ships.
 *
 * @param relativePath - POSIX path relative to the package's `src/` directory
 */
export function isSharedSourceFile(relativePath: string): boolean {
  const segments = relativePath.split('/');
  const name = segments.at(-1) ?? '';

  return !segments.slice(0, -1).some((segment) => EXCLUDED_DIRECTORIES.has(segment)) && !TEST_FILE_PATTERN.test(name);
}

function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** POSIX paths of every file under `absolute`, relative to it, skipping {@link EXCLUDED_DIRECTORIES}. */
function walk(absolute: string, prefix = ''): string[] {
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      return EXCLUDED_DIRECTORIES.has(entry.name) ? [] : walk(path.join(absolute, entry.name), `${child}/`);
    }

    return entry.isFile() ? [child] : [];
  });
}

/** Every bundled source file under `<directory>/src`, as POSIX paths relative to `directory`, in byte order. */
function listSourceFiles(root: string, directory: string): string[] {
  const sourceDir = toAbsolute(root, joinRepoPath(directory, SOURCE_DIR));
  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  return walk(sourceDir)
    .filter((file) => isSharedSourceFile(file))
    .map((file) => `${SOURCE_DIR}/${file}`)
    .sort(compareBytes);
}

/**
 * The workspace packages an action's bundle is built from, other than the action itself, each with
 * the SHA-256 of every bundled source file.
 *
 * The packages are the ones {@link sourceInputs} reaches through the `workspace:` entries of the
 * action's runtime dependency fields, transitively. Root lockfiles and toolchain pins are left out:
 * a lockfile changes with every dependency update anywhere in the repository, and releasing every
 * action for each of those would bury the releases that matter.
 *
 * @param root - absolute path of the repository root
 * @param actionDir - repository-relative directory of a Node action
 * @param packages - the result of `workspacePackages`, passed in when called repeatedly
 */
export function collectSharedSources(
  root: string,
  actionDir: string,
  packages: ReadonlyMap<string, string> = workspacePackages(root),
): SharedPackage[] {
  const names = new Map([...packages].map(([name, directory]) => [directory, name]));

  return sourceInputs(root, [actionDir], packages)
    .filter((input) => input !== actionDir && names.has(input))
    .sort(compareBytes)
    .map((directory) => ({
      name: names.get(directory) as string,
      directory,
      files: listSourceFiles(root, directory).map((file) => ({
        path: file,
        sha256: sha256Hex(fs.readFileSync(path.join(toAbsolute(root, directory), ...file.split('/')))),
      })),
    }));
}

/**
 * Renders the digest file for one action.
 *
 * release-please releases a package only for commits that touch its directory, and a fix in a shared
 * package touches none. Committing this file into each action that bundles the package makes such a
 * fix touch every one of them, so the commit's type decides their releases as it does for any other
 * change. Per-file digests, rather than one digest per package, make the diff show which files moved.
 */
export function renderSharedSources(actionDir: string, sharedPackages: readonly SharedPackage[]): string {
  const document = {
    comment: `AUTO-GENERATED by \`bun run generate-action-sources\`. Do not edit. The SHA-256 of every source file from a workspace package that ${actionDir} bundles. A change in one of those files changes this file, which puts the change inside this action's release-please package.`,
    packages: Object.fromEntries(
      sharedPackages.map((entry) => [
        entry.directory,
        { name: entry.name, files: Object.fromEntries(entry.files.map((file) => [file.path, file.sha256])) },
      ]),
    ),
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}
