/**
 * Which Verify targets a run has to execute.
 *
 * The `plan` job of `.github/workflows/verify.yaml` runs this before anything is installed, so this
 * module imports nothing outside the Node.js standard library: no `yaml`, no `action-graph`. The
 * graph work happens in the generator, which writes each target's inputs and build directories to
 * `.github/verify/plan.json`; the drift check keeps that file equal to what the graph derives.
 *
 * @packageDocumentation
 */

/** One target as the generator records it in the plan file. */
export interface PlannedTarget {
  /** `<category>/<name>`. */
  readonly id: string;
  /** The id of the generated workflow (shard) that holds the target's jobs. */
  readonly shard: string;
  /** Repository paths, directories or files, whose change selects the target. */
  readonly inputs: readonly string[];
  /** Action directories the shared build has to build for the target. */
  readonly buildDirs: readonly string[];
  /** Base branches a pull request must target; `null` for every branch. */
  readonly pullRequestBranches: readonly string[] | null;
  /** Branches other than `main` whose pushes run the target. */
  readonly pushBranches: readonly string[];
  /** Whether the weekly schedule runs the target. */
  readonly schedule: boolean;
}

/** The plan file. */
export interface PlanFile {
  /** Paths whose change selects every target. */
  readonly global: readonly string[];
  /** Glob patterns of changed files that select nothing: `*` is one segment, `**` any number. */
  readonly ignore: readonly string[];
  readonly targets: readonly PlannedTarget[];
}

/** The branch every push of which is verified when its inputs changed. */
export const DEFAULT_BRANCH = 'main';

/**
 * Changed files that select no target.
 *
 * release-please rewrites every released action's CHANGELOG.md, and the docs generator rewrites its
 * README.md on the same pull request; nothing reads either, so a release pull request that touches
 * every one of them must not run every suite. Matches the negations the path-filtered workflows
 * carried before.
 */
export const IGNORED_FILES: readonly string[] = ['**/CHANGELOG.md', 'actions/*/*/README.md'];

/** The changed files of a run, or `all` when they cannot be known and every target must run. */
export type ChangedFiles = readonly string[] | 'all';

/** The event facts the selection depends on. */
export type PlanEvent =
  | { readonly name: 'pull_request'; readonly baseRef: string }
  | { readonly name: 'push'; readonly branch: string }
  | { readonly name: 'schedule' }
  | { readonly name: 'workflow_dispatch' };

/** What the plan job reports. */
export interface PlanResult {
  /** Selected target ids, sorted. */
  readonly targets: readonly string[];
  /** Shards holding at least one selected target, sorted. */
  readonly shards: readonly string[];
  /** The union of the selected targets' build directories, sorted. */
  readonly buildDirs: readonly string[];
}

/** Whether `child` is `ancestor` or lies below it, on whole path segments. */
export function isWithin(ancestor: string, child: string): boolean {
  return child === ancestor || child.startsWith(`${ancestor}/`);
}

function matchSegments(pattern: readonly string[], parts: readonly string[]): boolean {
  if (pattern.length === 0) {
    return parts.length === 0;
  }
  const [head, ...rest] = pattern;
  if (head === '**') {
    for (let skip = 0; skip <= parts.length; skip++) {
      if (matchSegments(rest, parts.slice(skip))) {
        return true;
      }
    }
    return false;
  }

  return parts.length > 0 && (head === '*' || head === parts[0]) && matchSegments(rest, parts.slice(1));
}

/**
 * Whether a repository path matches a glob of whole segments: `*` matches exactly one segment and
 * `**` any number, including none. Partial-segment wildcards are not supported, on purpose: the
 * patterns are few, and a matcher this small cannot be misread.
 */
export function matchesGlob(pattern: string, file: string): boolean {
  return matchSegments(pattern.split('/'), file.split('/'));
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Whether the event lets the target run at all, before its inputs are considered. */
function eventAllows(target: PlannedTarget, event: PlanEvent): boolean {
  switch (event.name) {
    case 'pull_request': {
      return target.pullRequestBranches === null || target.pullRequestBranches.includes(event.baseRef);
    }
    case 'push': {
      return event.branch === DEFAULT_BRANCH || target.pushBranches.includes(event.branch);
    }
    case 'schedule': {
      return target.schedule;
    }
    case 'workflow_dispatch': {
      return true;
    }
  }
}

/** Whether the event runs every target its rules allow, whatever changed. */
function runsRegardlessOfChanges(event: PlanEvent): boolean {
  return event.name === 'schedule' || event.name === 'workflow_dispatch';
}

/**
 * Selects the targets a run executes.
 *
 * A target runs when the event allows it and a changed file, outside {@link PlanFile.ignore}, lies in
 * one of its inputs or in a global input. `schedule` runs the scheduled targets and
 * `workflow_dispatch` every target, whatever changed; so does `all` changed files.
 */
export function selectTargets(plan: PlanFile, event: PlanEvent, changed: ChangedFiles): PlanResult {
  const relevant =
    changed === 'all' ? 'all' : changed.filter((file) => !plan.ignore.some((pattern) => matchesGlob(pattern, file)));
  const touches = (inputs: readonly string[]): boolean =>
    relevant === 'all' || relevant.some((file) => inputs.some((input) => isWithin(input, file)));
  const everything = runsRegardlessOfChanges(event) || touches(plan.global);

  const selected = plan.targets.filter(
    (target) => eventAllows(target, event) && (everything || touches(target.inputs)),
  );

  return {
    targets: sortedUnique(selected.map((target) => target.id)),
    shards: sortedUnique(selected.map((target) => target.shard)),
    buildDirs: sortedUnique(selected.flatMap((target) => target.buildDirs)),
  };
}

/** A SHA git uses for "no commit": the `before` of a push that created the branch. */
export const NULL_SHA = '0000000000000000000000000000000000000000';

/** The environment the plan step reads, as the workflow passes it. */
export interface PlanEnvironment {
  readonly EVENT_NAME?: string;
  readonly BASE_REF?: string;
  readonly BASE_SHA?: string;
  readonly HEAD_SHA?: string;
  readonly REF?: string;
  readonly BEFORE?: string;
  readonly AFTER?: string;
}

/** How to diff two commits: `range` for `before..after`, `merge-base` for a pull request. */
export type DiffRequest =
  | { readonly kind: 'range'; readonly from: string; readonly to: string }
  | { readonly kind: 'merge-base'; readonly base: string; readonly head: string }
  | { readonly kind: 'all'; readonly reason: string }
  | { readonly kind: 'none' };

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Reads the event and the diff it calls for from the environment.
 *
 * @throws an `Error` for an event the workflow does not trigger on, or a missing value it must pass
 */
export function readEvent(env: PlanEnvironment): { event: PlanEvent; diff: DiffRequest } {
  const required = (name: keyof PlanEnvironment): string => {
    const value = env[name];
    if (value === undefined || value === '') {
      throw new Error(`${name} is not set; the plan step must pass it for a ${env.EVENT_NAME ?? 'missing'} event.`);
    }
    return value;
  };
  const sha = (name: keyof PlanEnvironment): string => {
    const value = required(name);
    if (!SHA_PATTERN.test(value)) {
      throw new Error(`${name} '${value}' is not a commit SHA.`);
    }
    return value;
  };

  switch (env.EVENT_NAME) {
    case 'pull_request': {
      return {
        event: { name: 'pull_request', baseRef: required('BASE_REF') },
        diff: { kind: 'merge-base', base: sha('BASE_SHA'), head: sha('HEAD_SHA') },
      };
    }
    case 'push': {
      const ref = required('REF');
      if (!ref.startsWith('refs/heads/')) {
        throw new Error(`REF '${ref}' is not a branch; Verify only runs on branch pushes.`);
      }
      const before = sha('BEFORE');
      return {
        event: { name: 'push', branch: ref.slice('refs/heads/'.length) },
        diff:
          before === NULL_SHA
            ? { kind: 'all', reason: 'the push created the branch, so there is no previous commit to compare' }
            : { kind: 'range', from: before, to: sha('AFTER') },
      };
    }
    case 'schedule':
    case 'workflow_dispatch': {
      return { event: { name: env.EVENT_NAME }, diff: { kind: 'none' } };
    }
    default: {
      throw new Error(`Verify does not plan for the ${env.EVENT_NAME ?? 'missing'} event.`);
    }
  }
}

/** Renders the step outputs, in the multi-line `GITHUB_OUTPUT` syntax. */
export function formatOutputs(result: PlanResult): string {
  return [
    `targets=${JSON.stringify(result.targets)}`,
    `shards=${JSON.stringify(result.shards)}`,
    `build=${result.buildDirs.length > 0 ? 'true' : 'false'}`,
    'build-dirs<<VERIFY_PLAN_EOF',
    ...result.buildDirs,
    'VERIFY_PLAN_EOF',
    '',
  ].join('\n');
}

/** Renders the job summary: why the plan chose what it chose, for whoever reads the run. */
export function formatSummary(result: PlanResult, changed: ChangedFiles, note?: string): string {
  const lines = ['## Verify plan', ''];
  if (note !== undefined) {
    lines.push(`> ${note}`, '');
  }
  lines.push(
    changed === 'all'
      ? 'Changed files: not compared; every target the event allows runs.'
      : `Changed files: ${changed.length}`,
    '',
    `Targets (${result.targets.length}):`,
    '',
    ...(result.targets.length === 0 ? ['- none'] : result.targets.map((target) => `- \`${target}\``)),
    '',
    `Build directories (${result.buildDirs.length}):`,
    '',
    ...(result.buildDirs.length === 0 ? ['- none'] : result.buildDirs.map((dir) => `- \`${dir}\``)),
    '',
  );

  return lines.join('\n');
}

/**
 * Validates the plan file's shape. It is generated, but it is read on a runner where a malformed file
 * must fail loudly rather than select nothing.
 *
 * @throws an `Error` describing the first problem
 */
export function parsePlanFile(text: string): PlanFile {
  const value = JSON.parse(text) as Partial<PlanFile> | null;
  const isStrings = (list: unknown): list is string[] =>
    Array.isArray(list) && list.every((entry) => typeof entry === 'string');
  if (value === null || typeof value !== 'object' || !isStrings(value.global) || !isStrings(value.ignore)) {
    throw new Error('The plan file must hold string lists global and ignore.');
  }
  if (!Array.isArray(value.targets) || value.targets.length === 0) {
    throw new Error('The plan file lists no targets.');
  }
  for (const target of value.targets) {
    const valid =
      typeof target.id === 'string' &&
      typeof target.shard === 'string' &&
      isStrings(target.inputs) &&
      isStrings(target.buildDirs) &&
      (target.pullRequestBranches === null || isStrings(target.pullRequestBranches)) &&
      isStrings(target.pushBranches) &&
      typeof target.schedule === 'boolean';
    if (!valid) {
      throw new Error(`The plan file entry ${JSON.stringify(target.id)} is malformed.`);
    }
  }

  return value as PlanFile;
}
