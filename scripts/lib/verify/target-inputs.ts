import fs from 'node:fs';
import path from 'node:path';

import {
  buildSet,
  e2eLocalRefs,
  findManifestFile,
  isWithin,
  parentOf,
  sortedUnique,
  sourceInputs,
  toAbsolute,
  workflowLocalRefs,
} from 'action-graph';
import { stringify } from 'yaml';

import { SHARED_BUILD_SCRIPT } from '../action-sources.js';

import type { VerifySource } from './source.js';

/**
 * What one target builds and which repository paths select it, derived from the dependency graph in
 * `packages/action-graph`, the same graph the release uses to decide what to publish.
 *
 * @packageDocumentation
 */

/** Directory under an action holding its `*.e2e.test.ts` files. */
export const E2E_DIRECTORY = 'e2e';

/** The package that runs the end-to-end cases; its sources and dependencies change every verdict. */
export const HARNESS_PACKAGE = 'packages/e2e';

/**
 * Directories a job may check this repository out to and reference its actions under, as in
 * `uses: ./tmp/actions-code/actions/x`. `actions/test/setup-e2e` checks it out to `tmp/actions-code`;
 * `common/fetch-head` checks it out to `source`.
 */
export const CHECKOUT_PREFIXES: readonly string[] = ['tmp/actions-code', 'source'];

/**
 * Root files the end-to-end run reads before any case loads: the vitest configuration, its setup and
 * aliases, and the root `package.json` whose `e2e` script starts it. A change to any of them changes
 * every end-to-end run.
 */
export const E2E_RUNNER_FILES: readonly string[] = [
  'package.json',
  'vitest.aliases.ts',
  'vitest.e2e.config.ts',
  'vitest.e2e.setup.ts',
];

/** Matches the module specifier of a static `import`/`export ... from`, or a side-effect `import`. */
const IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s+)['"]([^'"]+)['"]/g;

/**
 * A script and every file it reaches through relative imports, plus the directory of every workspace
 * package it imports by name, transitively. A specifier that resolves to no file is skipped: the
 * scanner also sees imports inside the code templates a script writes out.
 *
 * @param entry - repository-relative path of the script
 */
export function scriptImportClosure(root: string, entry: string, packages: ReadonlyMap<string, string>): string[] {
  const found = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (!found.has(file)) {
      found.add(file);
      const { modules, packageDirectories } = importsOf(root, file, packages);
      pending.push(...modules);
      for (const directory of packageDirectories) {
        found.add(directory);
      }
    }
  }

  return sortedUnique(found);
}

/** The source files one file imports relatively, and the directories of the workspace packages it imports. */
function importsOf(
  root: string,
  file: string,
  packages: ReadonlyMap<string, string>,
): { modules: string[]; packageDirectories: string[] } {
  const modules: string[] = [];
  const packageDirectories: string[] = [];

  for (const [, specifier = ''] of fs.readFileSync(toAbsolute(root, file), 'utf8').matchAll(IMPORT_SPECIFIER)) {
    const resolved = specifier.startsWith('.')
      ? resolveRelativeModule(root, path.posix.join(path.posix.dirname(file), specifier))
      : undefined;
    const directory = specifier.startsWith('.') ? undefined : packages.get(packageName(specifier));

    if (resolved !== undefined) {
      modules.push(resolved);
    }
    if (directory !== undefined) {
      packageDirectories.push(directory);
    }
  }

  return { modules, packageDirectories };
}

/** The package a bare specifier names: `@scope/name/sub` is `@scope/name`, `name/sub` is `name`. */
function packageName(specifier: string): string {
  const parts = specifier.split('/');

  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

/** The source file a relative specifier names, trying the TypeScript file behind a `.js` import. */
function resolveRelativeModule(root: string, target: string): string | undefined {
  const candidates = [target, target.replace(/\.js$/, '.ts'), `${target}.ts`, `${target}/index.ts`];

  return candidates.find((candidate) => {
    const absolute = toAbsolute(root, candidate);
    return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
  });
}

/** The derived facts of one target. */
export interface TargetInputs {
  /** Action directories whose bundles the target runs: where the shared build has to run. */
  readonly buildDirs: readonly string[];
  /**
   * Repository paths, directories or files, whose change selects the target. Sorted, and with no
   * entry inside another.
   */
  readonly inputs: readonly string[];
}

/** The nearest directory at or above `repoPath` that holds an action manifest, below `actions/`. */
function owningAction(root: string, repoPath: string): string | undefined {
  for (let directory = repoPath; directory !== '.'; directory = parentOf(directory)) {
    if (!isWithin('actions', directory)) {
      return undefined;
    }
    if (fs.existsSync(toAbsolute(root, directory)) && findManifestFile(root, directory) !== undefined) {
      return directory;
    }
  }

  return undefined;
}

/** The actions an action's end-to-end sources reach with `new URL('<literal>', import.meta.url)`. */
export function e2eSourceTargets(root: string, actionPath: string): string[] {
  const directory = `${actionPath}/${E2E_DIRECTORY}`;
  const absolute = toAbsolute(root, directory);
  if (!fs.existsSync(absolute)) {
    return [];
  }

  return fs
    .readdirSync(absolute)
    .filter((file) => file.endsWith('.ts'))
    .sort()
    .flatMap((file) => e2eLocalRefs(fs.readFileSync(path.join(absolute, file), 'utf8'), directory))
    .map((reference) => owningAction(root, reference))
    .filter((action): action is string => action !== undefined);
}

/** Whether an action has end-to-end cases. */
export function hasE2eCases(root: string, actionPath: string): boolean {
  const absolute = toAbsolute(root, `${actionPath}/${E2E_DIRECTORY}`);

  return fs.existsSync(absolute) && fs.readdirSync(absolute).some((file) => file.endsWith('.e2e.test.ts'));
}

/** The published action a directory belongs to: `actions/<category>/<name>`. */
function publishedAction(directory: string): string {
  return directory.split('/').slice(0, 3).join('/');
}

/** The action directory of a target, when the target is an action of this repository. */
export function targetAction(root: string, target: string): string | undefined {
  const directory = `actions/${target}`;

  return findManifestFile(root, directory) === undefined ? undefined : directory;
}

/**
 * The actions of this repository the source's jobs run with `uses: ./...`, either from the workspace
 * root or from one of {@link CHECKOUT_PREFIXES}. A reference to anything else, such as
 * `./round-trip/actions/demo`, is something a step wrote into the workspace at run time.
 */
export function jobActionRefs(source: VerifySource): string[] {
  const workflow = stringify({ jobs: source.jobs.toJSON() as unknown });

  return sortedUnique(
    workflowLocalRefs(workflow, CHECKOUT_PREFIXES)
      .map((ref) => ref.action)
      .filter((action) => isWithin('actions', action)),
  );
}

/**
 * Removes every entry that lies inside another, so `packages/ts-util` absorbs
 * `packages/ts-util/package.json`.
 */
function outermost(paths: readonly string[]): string[] {
  const unique = sortedUnique(paths);

  return unique.filter((entry) => !unique.some((other) => other !== entry && isWithin(other, entry)));
}

/**
 * Derives what a target builds and which paths select it.
 *
 * The build set covers every action the jobs run, every action the end-to-end cases load, and the
 * source's explicit `build` entries, each with its whole build set. The inputs are:
 *
 * - every published action in that build set, and the target's own action
 * - the workspace packages, lockfiles and toolchain pins its build directories read
 * - the end-to-end harness and its dependencies, for a target with cases
 * - the shared build script, when anything is built
 * - the source file, the generated workflow file the target's jobs live in, and `extra-inputs`
 *
 * @param root - absolute path of the repository root
 * @param source - the target's source
 * @param workflowFile - repository-relative path of the generated workflow that holds its jobs
 * @param packages - the result of `workspacePackages`, passed in because it walks the repository
 */
export function deriveTargetInputs(
  root: string,
  source: VerifySource,
  workflowFile: string,
  packages: ReadonlyMap<string, string>,
): TargetInputs {
  const own = targetAction(root, source.target);
  const e2eActions = source.e2e === undefined || own === undefined ? [] : [own, ...e2eSourceTargets(root, own)];
  const set = buildSet(root, [...e2eActions, ...jobActionRefs(source), ...source.build]);
  const builds = set.buildDirs.length > 0;

  return {
    buildDirs: set.buildDirs,
    inputs: outermost([
      ...set.actions.map(publishedAction),
      ...(own === undefined ? [] : [own]),
      ...(builds ? sourceInputs(root, set.buildDirs, packages) : []),
      ...(source.e2e === undefined ? [] : sourceInputs(root, [HARNESS_PACKAGE], packages)),
      ...(builds || source.e2e !== undefined ? scriptImportClosure(root, SHARED_BUILD_SCRIPT, packages) : []),
      ...(source.e2e === undefined ? [] : E2E_RUNNER_FILES),
      source.file,
      workflowFile,
      ...source.extraInputs,
    ]),
  };
}
