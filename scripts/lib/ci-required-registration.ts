import { parse } from 'yaml';

import { isVerifyWorkflowFile } from './ci-required.js';

// Registration barrier for the ci-required gate.
//
// The gate evaluates whenever a watched workflow completes. A verify workflow run that GitHub has not
// created yet is invisible to it: no run to count as unfinished, no `CI Summary:` check to count as
// failed. If an anchor such as Scripts CI completed first, the gate would report success for a head
// commit whose verify workflow had not started. This module decides, from the pull request's changed
// files and each verify workflow's `on.pull_request` filters, which verify workflows GitHub will run
// for the head commit, so the gate can stay pending until every one of them has a run.
//
// The filters are read from the default-branch copy of each verify workflow, which is what the gate
// checks out. Pure functions only: the entry point in scripts/ci-required-registration.ts does the
// I/O, and the unit suite exercises this file directly.

/**
 * GitHub evaluates path filters against at most this many changed files. Beyond it, whether a
 * path-filtered workflow runs depends on which files fall in the first 300, which the REST API does
 * not reveal, so the barrier cannot predict the set and stands down.
 */
export const PATH_FILTER_FILE_LIMIT = 300;

/** The `pull_request` activity types a workflow runs for when it names none. */
const DEFAULT_PULL_REQUEST_TYPES = ['opened', 'synchronize', 'reopened'];

/** `on.pull_request` filters of one workflow. Absent fields filter nothing. */
export interface PullRequestFilter {
  branches?: string[];
  branchesIgnore?: string[];
  paths?: string[];
  pathsIgnore?: string[];
  types?: string[];
}

/** A verify workflow on the default branch, as the gate sees it. */
export interface VerifyWorkflow {
  /** Repository-relative path, such as `.github/workflows/verify-action-x.yaml`. */
  path: string;
  /** Its `on.pull_request` filters, or undefined when it has no `pull_request` trigger. */
  pullRequest: PullRequestFilter | undefined;
}

/** One entry of `GET /repos/{repo}/pulls/{number}/files`. */
export interface ChangedFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

/** An open pull request whose head is the evaluated commit. */
export interface PullRequestChange {
  number: number;
  baseRef: string;
  /** The changed files, at most {@link PATH_FILTER_FILE_LIMIT} + 1 of them. */
  files: ChangedFile[];
}

/** One entry of `GET /repos/{repo}/actions/runs?head_sha=…`. */
export interface WorkflowRunSummary {
  path: string;
  status: string;
}

/**
 * How far the barrier applies to the evaluated commit.
 *
 * - `pull-request`: the head of at least one open pull request; the barrier is enforced.
 * - `no-pull-request`: not the head of an open pull request, such as a push to the default branch.
 * - `unresolved`: a `pull_request` run whose pull request could not be found. Fails closed.
 * - `too-many-files`: a pull request beyond {@link PATH_FILTER_FILE_LIMIT} changed files.
 */
export type RegistrationScope = 'pull-request' | 'no-pull-request' | 'unresolved' | 'too-many-files';

export interface Registration {
  scope: RegistrationScope;
  /** Verify workflows GitHub runs for the commit, by path. Empty outside the `pull-request` scope. */
  applicable: string[];
  /** Applicable verify workflows that have no run on the commit yet, by path. */
  missing: string[];
  /** Verify workflow runs on the commit that have not completed. */
  unfinished: number;
  /**
   * How many verify workflows must have reported a `CI Summary:` check once nothing is missing or
   * unfinished: the applicable ones under the barrier, otherwise the ones that ran.
   */
  expected: number;
}

const GLOB_CLASS = /^\[[A-Za-z0-9-]+\]/;

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`);
}

/** Wildcards, longest first, and the regular expression each stands for. */
const GLOB_WILDCARDS: readonly (readonly [string, string])[] = [
  ['**/', '(?:.*/)?'],
  ['**', '.*'],
  ['*', '[^/]*'],
];

/**
 * The next token of a filter pattern: the regular expression it compiles to, its length in the
 * pattern, and whether it quantifies the token before it.
 */
function nextGlobToken(pattern: string, rest: string): { source: string; length: number; quantifier: boolean } {
  const wildcard = GLOB_WILDCARDS.find(([glob]) => rest.startsWith(glob));
  if (wildcard) {
    return { source: wildcard[1], length: wildcard[0].length, quantifier: false };
  }
  if (rest[0] === '?' || rest[0] === '+') {
    return { source: rest[0], length: 1, quantifier: true };
  }
  if (rest[0] === '[') {
    const match = GLOB_CLASS.exec(rest);
    if (!match) {
      throw new Error(`Filter pattern '${pattern}' has an unsupported character class.`);
    }
    return { source: match[0], length: match[0].length, quantifier: false };
  }
  if (rest[0] === '\\' && rest.length > 1) {
    return { source: escapeRegExp(rest[1]), length: 2, quantifier: false };
  }
  return { source: escapeRegExp(rest[0]), length: 1, quantifier: false };
}

/**
 * Compiles one GitHub filter pattern, without a leading `!`, to an anchored regular expression.
 *
 * Follows the filter pattern cheat sheet in the GitHub Actions workflow syntax reference: `*` matches
 * within one path segment, `**` across segments, `**\/` also matches no directory at all, `?` and `+`
 * make the preceding character optional or repeatable, `[…]` is a class of letters, digits and
 * ranges, and `\` escapes the next character.
 */
export function globToRegExp(pattern: string): RegExp {
  const atoms: string[] = [];

  for (let index = 0; index < pattern.length;) {
    const token = nextGlobToken(pattern, pattern.slice(index));
    if (token.quantifier) {
      const previous = atoms.pop();
      if (previous === undefined) {
        throw new Error(`Filter pattern '${pattern}' starts with the quantifier '${token.source}'.`);
      }
      atoms.push(`(?:${previous})${token.source}`);
    } else {
      atoms.push(token.source);
    }
    index += token.length;
  }

  // eslint-disable-next-line security/detect-non-literal-regexp -- Every literal is escaped; the patterns come from the default-branch workflow files.
  return new RegExp(`^${atoms.join('')}$`);
}

/**
 * Whether `value` is included by an ordered pattern list in which a `!` pattern excludes what the
 * patterns before it included. As in GitHub, the last pattern that matches decides.
 */
export function matchesPatternList(value: string, patterns: readonly string[]): boolean {
  let included = false;

  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    if (globToRegExp(negated ? pattern.slice(1) : pattern).test(value)) {
      included = !negated;
    }
  }

  return included;
}

function stringList(value: unknown, field: string, workflow: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value;
  }
  throw new Error(`${workflow}: on.pull_request.${field} must be a string or a list of strings.`);
}

/**
 * Reads the `on.pull_request` filters of a workflow, or undefined when it has no `pull_request`
 * trigger. `path` only labels errors.
 *
 * Throws on combinations GitHub rejects, so a filter the barrier cannot model fails the gate's own
 * tests instead of being guessed at.
 */
export function pullRequestFilterOf(path: string, content: string): PullRequestFilter | undefined {
  const doc = parse(content) as Record<string, unknown> | null;
  // YAML 1.1 parsers read a bare `on` key as boolean true; the `yaml` package keeps the string.
  const on = doc?.on ?? doc?.true;

  if (on === 'pull_request') {
    return {};
  }
  if (Array.isArray(on)) {
    return on.includes('pull_request') ? {} : undefined;
  }
  if (typeof on !== 'object' || on === null || !('pull_request' in on)) {
    return undefined;
  }

  const raw = ((on as Record<string, unknown>).pull_request ?? {}) as Record<string, unknown>;
  const filter: PullRequestFilter = {
    branches: stringList(raw.branches, 'branches', path),
    branchesIgnore: stringList(raw['branches-ignore'], 'branches-ignore', path),
    paths: stringList(raw.paths, 'paths', path),
    pathsIgnore: stringList(raw['paths-ignore'], 'paths-ignore', path),
    types: stringList(raw.types, 'types', path),
  };

  if (filter.branches && filter.branchesIgnore) {
    throw new Error(`${path}: on.pull_request cannot set both branches and branches-ignore.`);
  }
  if (filter.paths && filter.pathsIgnore) {
    throw new Error(`${path}: on.pull_request cannot set both paths and paths-ignore.`);
  }

  return filter;
}

/** Whether a workflow with these filters runs for a `pull_request` event of `change`. */
export function runsForPullRequest(filter: PullRequestFilter, change: PullRequestChange): boolean {
  // The event that created the head commit's runs is `opened`, `synchronize` or `reopened`. A
  // workflow listing only other types may not have run for it, so it is not waited for.
  if (filter.types && !DEFAULT_PULL_REQUEST_TYPES.every((type) => filter.types?.includes(type))) {
    return false;
  }
  if (filter.branches && !matchesPatternList(change.baseRef, filter.branches)) {
    return false;
  }
  if (filter.branchesIgnore && matchesPatternList(change.baseRef, filter.branchesIgnore)) {
    return false;
  }

  const files = change.files.map((file) => file.filename);
  if (filter.paths) {
    const { paths } = filter;
    return files.some((file) => matchesPatternList(file, paths));
  }
  if (filter.pathsIgnore) {
    const { pathsIgnore } = filter;
    return files.some((file) => !matchesPatternList(file, pathsIgnore));
  }

  return true;
}

/** Whether `change` deletes or moves away the workflow file at `path`, so that it cannot run. */
function removesWorkflow(change: PullRequestChange, path: string): boolean {
  return change.files.some(
    (file) =>
      (file.status === 'removed' && file.filename === path) ||
      (file.status === 'renamed' && file.previous_filename === path),
  );
}

/** The workflow file a run belongs to. The path carries an `@ref` suffix for some events. */
function runWorkflowPath(run: WorkflowRunSummary): string {
  return run.path.split('@')[0];
}

function isVerifyRun(run: WorkflowRunSummary): boolean {
  const path = runWorkflowPath(run);
  return path.startsWith('.github/workflows/') && isVerifyWorkflowFile(path.slice('.github/workflows/'.length));
}

export interface RegistrationInput {
  /** The `event` of the triggering workflow run. */
  event: string;
  /** Verify workflows on the default branch that are enabled. */
  workflows: readonly VerifyWorkflow[];
  /** Open pull requests whose head is the evaluated commit. */
  pullRequests: readonly PullRequestChange[];
  /** Every workflow run on the evaluated commit. */
  runs: readonly WorkflowRunSummary[];
}

/** Decides which verify workflows the gate waits for, and which of them have no run yet. */
export function evaluateRegistration(input: RegistrationInput): Registration {
  const verifyRuns = input.runs.filter(isVerifyRun);
  const registered = new Set(verifyRuns.map(runWorkflowPath));
  const unfinished = verifyRuns.filter((run) => run.status !== 'completed').length;
  const withoutBarrier = (scope: RegistrationScope): Registration => ({
    scope,
    applicable: [],
    missing: [],
    unfinished,
    expected: registered.size,
  });

  if (input.pullRequests.length === 0) {
    return withoutBarrier(input.event === 'pull_request' ? 'unresolved' : 'no-pull-request');
  }
  if (input.pullRequests.some((change) => change.files.length > PATH_FILTER_FILE_LIMIT)) {
    return withoutBarrier('too-many-files');
  }

  const applicable = input.workflows
    .filter(({ path, pullRequest }) =>
      input.pullRequests.some(
        (change) =>
          pullRequest !== undefined && !removesWorkflow(change, path) && runsForPullRequest(pullRequest, change),
      ),
    )
    .map(({ path }) => path)
    .sort();

  return {
    scope: 'pull-request',
    applicable,
    missing: applicable.filter((path) => !registered.has(path)),
    unfinished,
    expected: applicable.length,
  };
}
