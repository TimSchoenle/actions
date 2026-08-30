import { parse } from 'yaml';

// ---------------------------------------------------------------------------
// Branch-protection contract.
//
// The default-branch ruleset marks a handful of contexts *required*. GitHub has
// no notion of "this context is optional when it does not apply": a required
// context that never reports leaves the pull request on "Expected — waiting for
// status to be reported" forever, and a required context that reports too early
// gates on nothing at all. Both failure modes are invisible in the workflow
// files themselves, so they are encoded here and asserted by the contract test.
//
// This module is deliberately free of any filesystem or Bun-specific API so the
// vitest suite (which runs under Node) can exercise it against inline fixtures
// as well as against the real workflows on disk.
// ---------------------------------------------------------------------------

/** Branch the ruleset targets, and therefore the base every required check must cover. */
export const DEFAULT_BRANCH = 'main';

/** How a required context reaches GitHub. */
export type RequiredCheckKind =
  /**
   * A check run GitHub creates from a job. A *plain* job always reports under
   * its own name — including a `skipped` conclusion when its `if:` is false,
   * which branch protection accepts. A job that is a reusable-workflow call
   * (`uses:`) does not: while it runs, its checks are named
   * `<caller job> / <called job>`, and while it is skipped only the bare caller
   * name appears. Requiring either name is unsafe, so a `job` context must
   * resolve to a plain job.
   */
  | 'job'
  /**
   * A commit status POSTed by a step to an explicit SHA. Unlike a check run it
   * is not bound to the run's own head commit, which is what lets a
   * `workflow_run`-triggered evaluation report back onto the pull request head.
   */
  | 'status';

export interface RequiredCheck {
  /** The context string exactly as it appears in the ruleset. */
  context: string;
  /** Workflow file under `.github/workflows/` that must produce it. */
  workflow: string;
  kind: RequiredCheckKind;
  /** Why this context is the right thing to gate on. */
  reason: string;
}

/**
 * The contexts marked required on the `~DEFAULT_BRANCH` ruleset.
 *
 * GitHub stays the source of truth for enforcement; this list is the source of
 * truth for *reviewability*. Adding a context here without adding it to the
 * ruleset gates nothing, and adding it to the ruleset without adding it here
 * forfeits the guarantees the contract test provides.
 */
export const REQUIRED_CHECKS: readonly RequiredCheck[] = [
  {
    context: 'Lint & Test',
    workflow: 'scripts-ci.yml',
    kind: 'job',
    reason: 'Format, lint, typecheck, generated-source drift and the unit suite.',
  },
  {
    context: 'Action Lint',
    workflow: 'security.yml',
    kind: 'job',
    reason: 'actionlint over every workflow in the repository.',
  },
  {
    context: 'Build Actions and Commit',
    workflow: 'update-files.yml',
    kind: 'job',
    reason: 'Compiled bundles are committed, so a red build must not merge.',
  },
  {
    context: 'Update README',
    workflow: 'update-files.yml',
    kind: 'job',
    reason: 'Generated documentation is committed, so a red regeneration must not merge.',
  },
  {
    context: 'Auto Format Gate',
    workflow: 'auto-format.yml',
    kind: 'job',
    reason:
      'Plain-job stand-in for the "Auto Format / Auto Format" reusable-workflow check, which vanishes whenever the call is skipped.',
  },
  {
    context: 'ci-required',
    workflow: 'ci-required.yaml',
    kind: 'status',
    reason:
      'Aggregate of the path-filtered verify workflows. The "Aggregate verify checks" job name must NOT be required in its place: on a pull_request it evaluates before any verify workflow has started and passes with zero matches, and the authoritative workflow_run re-evaluations run on the default branch, so their check runs never land on the pull request head.',
  },
];

/**
 * Contexts that look like reasonable gates but are unsound, with the reason.
 *
 * Every entry here is a mistake that was actually made, or the obvious next one:
 * the structural checks below cannot catch a context that reports faithfully and
 * still gates nothing, so those are named outright.
 */
export const FORBIDDEN_REQUIRED_CHECKS: Readonly<Record<string, string>> = {
  'Aggregate verify checks':
    "The job name behind ci-required. On a pull_request it evaluates before any verify workflow has started and passes with zero matches; the authoritative workflow_run re-evaluations run on the default branch, so their check runs never reach the pull request head. Require the 'ci-required' commit status instead.",
  'Auto Format / Auto Format':
    "The nested name of a reusable-workflow call, which disappears whenever the call is skipped. Require 'Auto Format Gate' instead.",
  'Auto Approve Renovate / Auto-approve PR':
    'Same nested-call shape, and it only runs for one bot author. It can never gate a human pull request.',
};

export interface WorkflowJob {
  id: string;
  /** The context GitHub reports for this job: its `name:`, or its id when unnamed. */
  checkName: string;
  /** True when the job delegates to a reusable workflow via `uses:`. */
  isReusableCall: boolean;
}

export interface WorkflowTriggers {
  /** True when the workflow declares an `on.pull_request` trigger at all. */
  onPullRequest: boolean;
  /** `paths` / `paths-ignore` filters, which make the trigger conditional. */
  pathFiltered: boolean;
  /** Explicit `branches` allow-list, when present. */
  branches?: string[];
  /** True when `branches-ignore` is present, which can exclude the base branch. */
  branchesIgnored: boolean;
}

export interface ParsedWorkflow {
  name: string;
  triggers: WorkflowTriggers;
  jobs: WorkflowJob[];
}

function asStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return undefined;
}

function readTriggers(on: unknown): WorkflowTriggers {
  const absent: WorkflowTriggers = { onPullRequest: false, pathFiltered: false, branchesIgnored: false };

  // `on: pull_request` and `on: [pull_request]` carry no filters at all; only the mapping form can.
  if (typeof on === 'string') {
    return { ...absent, onPullRequest: on === 'pull_request' };
  }
  if (Array.isArray(on)) {
    return { ...absent, onPullRequest: on.includes('pull_request') };
  }
  if (on === null || typeof on !== 'object') {
    return absent;
  }

  const events = on as Record<string, unknown>;
  if (!Object.hasOwn(events, 'pull_request')) {
    return absent;
  }

  // `pull_request:` with no filters parses as null, which is the unconditional case.
  const filters = (events.pull_request ?? {}) as Record<string, unknown>;
  return {
    onPullRequest: true,
    pathFiltered: Object.hasOwn(filters, 'paths') || Object.hasOwn(filters, 'paths-ignore'),
    branches: asStringArray(filters.branches),
    branchesIgnored: Object.hasOwn(filters, 'branches-ignore'),
  };
}

export function parseWorkflow(content: string): ParsedWorkflow {
  const doc = parse(content) as { name?: unknown; on?: unknown; jobs?: Record<string, unknown> } | null;
  const rawJobs = doc?.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};

  const jobs: WorkflowJob[] = Object.entries(rawJobs).map(([id, value]) => {
    const job = (value ?? {}) as { name?: unknown; uses?: unknown };
    return {
      id,
      checkName: typeof job.name === 'string' ? job.name : id,
      isReusableCall: typeof job.uses === 'string',
    };
  });

  return {
    name: typeof doc?.name === 'string' ? doc.name : '',
    triggers: readTriggers(doc?.on),
    jobs,
  };
}

/** True when a `branches:` allow-list lets a pull request targeting `base` through. */
export function branchesAllow(branches: readonly string[] | undefined, base: string): boolean {
  if (branches === undefined) {
    return true;
  }
  // Only the shapes this repository uses are treated as matching: the literal branch name and a bare
  // wildcard. Anything more exotic is reported rather than guessed at.
  return branches.some((pattern) => pattern === base || pattern === '*' || pattern === '**');
}

export interface RequiredCheckProblem {
  context: string;
  reason: string;
}

/**
 * Every way `check` is unsound as a required status check, given the workflow
 * that is meant to produce it. All problems are returned so one run reports the
 * full picture instead of only the first failure.
 */
export function findRequiredCheckProblems(
  check: RequiredCheck,
  workflow: ParsedWorkflow | undefined,
  content: string | undefined,
  defaultBranch: string = DEFAULT_BRANCH,
): RequiredCheckProblem[] {
  const problems: RequiredCheckProblem[] = [];
  const fail = (reason: string): void => {
    problems.push({ context: check.context, reason });
  };

  if (workflow === undefined || content === undefined) {
    fail(`${check.workflow} does not exist.`);
    return problems;
  }

  const { triggers } = workflow;
  if (!triggers.onPullRequest) {
    fail(`${check.workflow} has no 'on.pull_request' trigger, so the context never reports on a pull request.`);
  }
  if (triggers.pathFiltered) {
    fail(`${check.workflow} filters 'on.pull_request' by path, so the context is missing on unrelated pull requests.`);
  }
  if (triggers.branchesIgnored) {
    fail(`${check.workflow} uses 'on.pull_request.branches-ignore', which can exclude '${defaultBranch}'.`);
  }
  if (!branchesAllow(triggers.branches, defaultBranch)) {
    fail(`${check.workflow} restricts 'on.pull_request.branches' to [${triggers.branches?.join(', ')}].`);
  }

  if (check.kind === 'status') {
    if (!content.includes(`context="${check.context}"`)) {
      fail(`${check.workflow} never posts a commit status with context "${check.context}".`);
    }
    return problems;
  }

  const producers = workflow.jobs.filter((job) => job.checkName === check.context);
  if (producers.length === 0) {
    fail(`${check.workflow} has no job reporting as '${check.context}'.`);
  }
  for (const job of producers) {
    if (job.isReusableCall) {
      fail(
        `job '${job.id}' in ${check.workflow} is a reusable-workflow call, so it reports as '${check.context} / <called job>' while running and only as '${check.context}' while skipped.`,
      );
    }
  }

  return problems;
}
