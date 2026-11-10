import { buildSet, localUsesPath, parsePathList, toRepoPath } from 'action-graph';
import { parse } from 'yaml';

import { BUILD_ACTIONS, INSTALL_BUILT_ACTIONS } from './e2e-fragment.js';

/**
 * The contract every workflow that runs this repository's actions from a checkout must keep: a step
 * that runs a local action with a bundle comes after an install of that bundle, built from the same
 * commit, in the same job.
 *
 * Generated verify workflows keep it by construction. The check exists for the hand-written ones,
 * where a new `uses: ./actions/x` would otherwise run whatever bundle happens to be committed, or,
 * once bundles are no longer committed, none at all.
 */

/** One step that runs a local action with a bundle it has not installed. */
export interface ContractViolation {
  readonly job: string;
  readonly step: number;
  readonly uses: string;
  readonly reason: string;
}

/** Owner and repository of this repository's actions, as a pinned `uses:` names them. */
const REPOSITORY_ID = 'TimSchoenle/actions';

/** The remote action that checks this repository out at `current_repo_checkout_path`. */
const SETUP_E2E = 'actions/test/setup-e2e';

/**
 * The actions this contract cannot apply to: they are what installs and builds the bundles, so they
 * run with the bundle the checkout carries until they are pinned to a release.
 */
const SELF_HOSTING: ReadonlySet<string> = new Set([BUILD_ACTIONS, INSTALL_BUILT_ACTIONS]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stepsOf(job: unknown): Record<string, unknown>[] {
  return isRecord(job) && Array.isArray(job['steps']) ? job['steps'].filter(isRecord) : [];
}

function needsOf(job: unknown): string[] {
  const needs = isRecord(job) ? job['needs'] : undefined;
  if (typeof needs === 'string') {
    return [needs];
  }

  return Array.isArray(needs) ? needs.filter((need): need is string => typeof need === 'string') : [];
}

function input(step: Record<string, unknown>, name: string): string | undefined {
  const value = isRecord(step['with']) ? step['with'][name] : undefined;

  return typeof value === 'string' ? value : undefined;
}

/** The action a `uses:` value names in this repository, local or pinned, without checkout prefix. */
function namesAction(uses: string, action: string): boolean {
  const local = localUsesPath(uses);

  return local === undefined
    ? uses.toLowerCase().startsWith(`${REPOSITORY_ID.toLowerCase()}/${action}@`)
    : local === action || local.endsWith(`/${action}`);
}

/** The directories this repository is checked out to by a job's steps. */
function checkoutPrefixes(steps: readonly Record<string, unknown>[]): string[] {
  const prefixes = steps.flatMap((step) => {
    const uses = typeof step['uses'] === 'string' ? step['uses'] : '';
    if (uses.startsWith('actions/checkout@')) {
      return [toRepoPath(input(step, 'path') || '.', 'checkout path')];
    }
    if (namesAction(uses, SETUP_E2E)) {
      return [toRepoPath(input(step, 'current_repo_checkout_path') || 'tmp/current-repo', 'checkout path')];
    }

    return [];
  });

  return [...new Set(prefixes)].sort((a, b) => b.length - a.length);
}

/** The directories each job's build step builds, by job id. */
function buildJobs(jobs: Record<string, unknown>): Map<string, ReadonlySet<string>> {
  const built = new Map<string, ReadonlySet<string>>();
  for (const [id, job] of Object.entries(jobs)) {
    for (const step of stepsOf(job)) {
      if (typeof step['uses'] === 'string' && namesAction(step['uses'], BUILD_ACTIONS)) {
        const dirs = input(step, 'build-dirs') ?? '';
        built.set(id, new Set(dirs.includes('${{') ? [] : parsePathList(dirs, 'build directory')));
      }
    }
  }

  return built;
}

/** The build job an install step reads its artifact from, through `needs.<job>.outputs`. */
function sourceJob(step: Record<string, unknown>): string | undefined {
  return /needs\.([\w-]+)\.outputs\./.exec(input(step, 'artifact-id') ?? '')?.[1];
}

/**
 * Every step of a workflow that runs a local action with a bundle without having installed it.
 *
 * A step is covered by an earlier step in the same job that runs `release/install-built-actions` into
 * the checkout the action is run from, reading the artifact of a job it needs whose
 * `release/build-actions` step lists every build directory the action needs.
 *
 * @param content - the workflow file's text
 * @param root - absolute path of the repository root, for the build sets
 */
export function builtActionsViolations(content: string, root: string): ContractViolation[] {
  const document: unknown = parse(content);
  const jobs = isRecord(document) && isRecord(document['jobs']) ? document['jobs'] : {};
  const builds = buildJobs(jobs);
  const violations: ContractViolation[] = [];

  for (const [jobId, job] of Object.entries(jobs)) {
    const steps = stepsOf(job);
    const prefixes = checkoutPrefixes(steps);
    const needs = new Set(needsOf(job));

    steps.forEach((step, index) => {
      const uses = typeof step['uses'] === 'string' ? step['uses'] : '';
      const local = localUsesPath(uses);
      if (local === undefined) {
        return;
      }
      const prefix = prefixes.find((candidate) => candidate === '.' || local.startsWith(`${candidate}/`));
      const action = prefix === undefined || prefix === '.' ? local : local.slice(prefix.length + 1);
      if (prefix === undefined || !action.startsWith('actions/') || SELF_HOSTING.has(action)) {
        return;
      }
      const required = buildSet(root, [action]).buildDirs;
      if (required.length === 0) {
        return;
      }

      const installs = steps
        .slice(0, index)
        .filter((earlier) => typeof earlier['uses'] === 'string' && namesAction(earlier['uses'], INSTALL_BUILT_ACTIONS))
        .filter((earlier) => toRepoPath(input(earlier, 'path') || '.', 'install path') === prefix);
      const covered = installs.some((install) => {
        const source = sourceJob(install);
        const built = source === undefined || !needs.has(source) ? undefined : builds.get(source);

        return built !== undefined && required.every((directory) => built.has(directory));
      });
      if (!covered) {
        violations.push({
          job: jobId,
          step: index,
          uses,
          reason:
            installs.length === 0
              ? `runs ${action}, which needs ${required.join(', ')}, with no earlier install-built-actions into ${prefix}`
              : `runs ${action}, but no earlier install reads a needed build job whose build-dirs cover ${required.join(', ')}`,
        });
      }
    });
  }

  return violations;
}
