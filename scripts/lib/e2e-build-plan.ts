import fs from 'node:fs';
import path from 'node:path';

import {
  buildSet,
  e2eLocalRefs,
  findManifestFile,
  isWithin,
  mergeBuildSets,
  parentOf,
  sortedUnique,
  sourceInputs,
  toAbsolute,
  workspacePackages,
} from 'action-graph';

import { fragmentLocalRefs } from './e2e-fragment.js';
import { E2E_DIRECTORY } from './e2e-workflow.js';
import { ROOT_DIR } from './utils.js';

import type { BuildSet } from 'action-graph';

/** What one generated verify workflow builds, installs and triggers on. */
export interface E2eBuildPlan {
  /** Every directory the build job builds; empty when nothing the workflow runs ships a bundle. */
  readonly buildDirs: readonly string[];
  /** Fragment jobs that run a local action with a bundle, with the checkouts to install into. */
  readonly installs: ReadonlyMap<string, readonly string[]>;
  /** Positive `paths` globs, sorted. */
  readonly triggerIncludes: readonly string[];
  /** Paths excluded again, sorted, rendered after every include. */
  readonly triggerExcludes: readonly string[];
}

/** The package that runs the end-to-end cases; its sources and dependencies change every verdict. */
const HARNESS_PACKAGE = 'packages/e2e';

/** The shared bundler every action's `build` script runs. */
const SHARED_BUILD_SCRIPT = 'scripts/build-action.ts';

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
function e2eSourceTargets(root: string, actionPath: string): string[] {
  const directory = `${actionPath}/${E2E_DIRECTORY}`;
  const absolute = toAbsolute(root, directory);
  if (!fs.existsSync(absolute)) {
    return [];
  }

  return fs
    .readdirSync(absolute)
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) => e2eLocalRefs(fs.readFileSync(path.join(absolute, file), 'utf8'), directory))
    .map((reference) => owningAction(root, reference))
    .filter((action): action is string => action !== undefined);
}

/** The published action a directory belongs to: `actions/<category>/<name>`. */
function publishedAction(directory: string): string {
  return directory.split('/').slice(0, 3).join('/');
}

/**
 * A repository path as a `paths` glob: a directory as `<dir>/**`, anything else as it is. The
 * workflow file itself does not exist yet when the generator first writes it.
 */
function toGlob(root: string, repoPath: string): string {
  const absolute = toAbsolute(root, repoPath);

  return fs.existsSync(absolute) && fs.statSync(absolute).isDirectory() ? `${repoPath}/**` : repoPath;
}

/**
 * Plans the build, the installs and the trigger paths of one action's verify workflow.
 *
 * The build covers the action itself, every action its end-to-end sources reach through
 * `new URL('<literal>', import.meta.url)`, and every action its extra jobs run with
 * `uses: ./<checkout>/actions/...`, each with its whole build set. A sibling pinned by SHA is never
 * built: the runner fetches it with the bundle its release carries.
 *
 * The triggers are every directory the build reads from, the harness and its dependencies, the
 * lockfile and toolchain pins, the shared build script and the workflow itself. A pull request that
 * only changes `packages/ts-util` therefore runs every verify workflow whose bundles include it.
 *
 * @param workflowFile - the workflow's path, relative to the repository root
 */
export function planE2eBuild(
  actionPath: string,
  fragment: string,
  workflowFile: string,
  root = ROOT_DIR,
): E2eBuildPlan {
  const fragmentRefs = fragmentLocalRefs(fragment);
  const ownSet = buildSet(root, [actionPath, ...e2eSourceTargets(root, actionPath)]);
  const set: BuildSet = mergeBuildSets([
    ownSet,
    buildSet(
      root,
      fragmentRefs.map((ref) => ref.action),
    ),
  ]);

  const installs = new Map<string, string[]>();
  for (const ref of fragmentRefs) {
    if (buildSet(root, [ref.action]).buildDirs.length === 0) {
      continue;
    }
    const prefixes = installs.get(ref.job) ?? [];
    installs.set(ref.job, sortedUnique([...prefixes, ref.prefix]));
  }

  const packages = workspacePackages(root);
  const reads = sortedUnique([
    ...set.actions.map(publishedAction),
    ...(set.buildDirs.length === 0 ? [] : sourceInputs(root, set.buildDirs, packages)),
    ...sourceInputs(root, [HARNESS_PACKAGE], packages),
    SHARED_BUILD_SCRIPT,
    workflowFile,
  ]);
  const published = sortedUnique(set.actions.map(publishedAction));

  return {
    buildDirs: set.buildDirs,
    installs,
    triggerIncludes: sortedUnique(
      reads
        .filter((input) => !reads.some((other) => other !== input && isWithin(other, input)))
        .map((input) => toGlob(root, input)),
    ),
    triggerExcludes: published.flatMap((action) => [`${action}/CHANGELOG.md`, `${action}/README.md`]),
  };
}
