import fs from 'node:fs';

import {
  affected,
  buildSet,
  findActions,
  joinRepoPath,
  ROOT,
  sortedUnique,
  sourceInputs,
  toAbsolute,
  workflowLocalRefs,
} from 'action-graph';

/** What to resolve. */
export type ResolveMode = 'build-set' | 'affected';

export const RESOLVE_MODES: readonly ResolveMode[] = ['build-set', 'affected'];

/** One resolution request. Every path is relative to {@link ResolveRequest.root}. */
export interface ResolveRequest {
  /** Absolute path of the checkout root. */
  readonly root: string;
  readonly targets: readonly string[];
  readonly workflows: readonly string[];
  readonly checkoutPrefixes: readonly string[];
  readonly exclude: readonly string[];
  readonly mode: ResolveMode;
  readonly changedFiles: readonly string[];
}

/** The answer, every list sorted. */
export interface Resolution {
  readonly buildDirs: readonly string[];
  readonly bundles: readonly string[];
  readonly actions: readonly string[];
  readonly sourcePaths: readonly string[];
}

/** The local actions the workflows run, with checkout prefixes removed. */
function workflowTargets(request: ResolveRequest): string[] {
  return request.workflows.flatMap((workflow) => {
    const file = toAbsolute(request.root, workflow);
    if (!fs.existsSync(file)) {
      throw new Error(`Workflow ${workflow} does not exist.`);
    }

    return workflowLocalRefs(fs.readFileSync(file, 'utf8'), request.checkoutPrefixes).map((ref) => ref.action);
  });
}

/** A directory becomes `<dir>/**`, the whole repository `**`, and a file stays as it is. */
function toGlob(root: string, repoPath: string): string {
  if (!fs.statSync(toAbsolute(root, repoPath)).isDirectory()) {
    return repoPath;
  }

  return repoPath === ROOT ? '**' : joinRepoPath(repoPath, '**');
}

/**
 * Resolves the build set of the requested actions.
 *
 * The candidates are the given targets plus every local action the given workflows run. With
 * neither, every action below the root is a candidate, minus `exclude`. In `affected` mode only the
 * candidates a changed file affects are kept.
 *
 * @throws an `Error` for a workflow that does not exist, or a `ManifestError` for an action without a
 * valid manifest
 */
export function resolveActions(request: ResolveRequest): Resolution {
  const explicit = sortedUnique([...request.targets, ...workflowTargets(request)]);
  const candidates =
    explicit.length > 0 ? explicit : findActions(request.root, { excludedDirectories: request.exclude });
  const selected = request.mode === 'affected' ? affected(request.root, request.changedFiles, candidates) : candidates;

  const set = buildSet(request.root, selected);
  const inputs = [...set.actions, ...(set.buildDirs.length === 0 ? [] : sourceInputs(request.root, set.buildDirs))];

  return {
    buildDirs: set.buildDirs,
    bundles: set.bundles,
    actions: set.actions,
    sourcePaths: sortedUnique(inputs.map((input) => toGlob(request.root, input))),
  };
}
