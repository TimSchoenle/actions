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
    reason:
      'Compiled bundles are committed, so a red build must not merge. The privileged commit job, which runs after the unprivileged "Build Actions" job and fails when it did.',
  },
  {
    context: 'Update README',
    workflow: 'update-files.yml',
    kind: 'job',
    reason:
      'Generated documentation is committed, so a red regeneration must not merge. Also fails when "Regenerate Workflows", which is not required, failed.',
  },
  {
    context: 'Auto Format Gate',
    workflow: 'auto-format.yml',
    kind: 'job',
    reason:
      'Always-running gate over the "Format" and "Commit Format" jobs, both of which are skipped on release-please branches and so cannot be required themselves.',
  },
  {
    context: 'ci-required',
    workflow: 'ci-required.yaml',
    kind: 'status',
    reason:
      'Aggregate of the path-filtered verify workflows, posted only by the workflow_run evaluation, which runs the default-branch copy of ci-required.yaml; the workflow has no pull_request trigger, so no copy a pull request controls ever publishes it. The "Aggregate verify checks" job name must NOT be required in its place: its workflow_run check runs land on the default branch, never on the pull request head.',
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
    "The job name behind ci-required. It only runs on workflow_run, on the default branch, so its check runs never reach the pull request head and the context would wait for ever. Require the 'ci-required' commit status instead.",
  'Auto Format / Auto Format':
    "The nested name of the reusable-workflow call auto-format.yml used to make, which disappeared whenever the call was skipped. Require 'Auto Format Gate' instead.",
  'Auto Approve Renovate / Auto-approve PR':
    'Same nested-call shape, and it only runs for one bot author. It can never gate a human pull request.',
};

export interface WorkflowJob {
  id: string;
  /** The context GitHub reports for this job: its `name:`, or its id when unnamed. */
  checkName: string;
  /** True when the job delegates to a reusable workflow via `uses:`. */
  isReusableCall: boolean;
  /** Ids of the jobs listed in `needs:`. */
  needs: string[];
  /** The job's `if:` expression, or an empty string when it has none. */
  condition: string;
  /** The job serialised back to text, for checks that look for an expression anywhere in it. */
  source: string;
}

export interface WorkflowTriggers {
  /** True when the workflow declares an `on.pull_request` trigger at all. */
  onPullRequest: boolean;
  /** True when the workflow declares an `on.workflow_run` trigger. */
  onWorkflowRun: boolean;
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
  const absent: WorkflowTriggers = {
    onPullRequest: false,
    onWorkflowRun: false,
    pathFiltered: false,
    branchesIgnored: false,
  };

  // `on: pull_request` and `on: [pull_request]` carry no filters at all; only the mapping form can.
  if (typeof on === 'string') {
    return { ...absent, onPullRequest: on === 'pull_request', onWorkflowRun: on === 'workflow_run' };
  }
  if (Array.isArray(on)) {
    return { ...absent, onPullRequest: on.includes('pull_request'), onWorkflowRun: on.includes('workflow_run') };
  }
  if (on === null || typeof on !== 'object') {
    return absent;
  }

  const events = on as Record<string, unknown>;
  const onWorkflowRun = Object.hasOwn(events, 'workflow_run');
  if (!Object.hasOwn(events, 'pull_request')) {
    return { ...absent, onWorkflowRun };
  }

  // `pull_request:` with no filters parses as null, which is the unconditional case.
  const filters = (events.pull_request ?? {}) as Record<string, unknown>;
  return {
    onPullRequest: true,
    onWorkflowRun,
    pathFiltered: Object.hasOwn(filters, 'paths') || Object.hasOwn(filters, 'paths-ignore'),
    branches: asStringArray(filters.branches),
    branchesIgnored: Object.hasOwn(filters, 'branches-ignore'),
  };
}

export function parseWorkflow(content: string): ParsedWorkflow {
  const doc = parse(content) as { name?: unknown; on?: unknown; jobs?: Record<string, unknown> } | null;
  const rawJobs = doc?.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};

  const jobs: WorkflowJob[] = Object.entries(rawJobs).map(([id, value]) => {
    const job = (value ?? {}) as { name?: unknown; uses?: unknown; needs?: unknown; if?: unknown };
    return {
      id,
      checkName: typeof job.name === 'string' ? job.name : id,
      isReusableCall: typeof job.uses === 'string',
      needs: asStringArray(job.needs) ?? [],
      condition: typeof job.if === 'string' ? job.if : typeof job.if === 'boolean' ? String(job.if) : '',
      source: JSON.stringify(job),
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

/** Status functions that let a job run after one of its `needs` failed. */
const RUNS_AFTER_FAILURE = /\balways\(\)|!\s*cancelled\(\)/;

/** `success()` in a job's `if:` is false once any need failed, so it undoes `always()`. */
const SUCCESS_FUNCTION = /\bsuccess\(\)/;

/**
 * `needs.<id>.result == 'success'` in a job's `if:`: the same skip, spelled out for one need.
 *
 * This and {@link SUCCESS_FUNCTION} catch the realistic way to undo `always()`. They are not an
 * expression evaluator: a condition built to hide the dependency still needs a reviewer.
 */
function successGate(need: string): RegExp {
  const id = need.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // eslint-disable-next-line security/detect-non-literal-regexp -- the job id is escaped above
  return new RegExp(`needs\\.${id}\\.result\\s*==\\s*['"]success['"]`);
}

/**
 * Why `job` can pass while one of its `needs` failed, or `undefined` when it cannot.
 *
 * A job is skipped when a job it needs fails, unless its `if:` says otherwise, and a skipped job
 * reports success to branch protection. So a required job downstream of a job that is *not* itself
 * required would wave that failure through. It has to run regardless (`always()` or `!cancelled()`)
 * and then read the result of each such need, so it can fail on it.
 */
function unguardedNeed(
  job: WorkflowJob,
  workflow: ParsedWorkflow,
  requiredContexts: readonly string[],
): string | undefined {
  const unrequired = job.needs.filter((need) => {
    const upstream = workflow.jobs.find((candidate) => candidate.id === need);
    return upstream === undefined || !requiredContexts.includes(upstream.checkName);
  });

  if (unrequired.length === 0) {
    return undefined;
  }
  if (!RUNS_AFTER_FAILURE.test(job.condition)) {
    return `job '${job.id}' needs ${unrequired.join(', ')}, which ${unrequired.length === 1 ? 'is' : 'are'} not required, but its 'if:' has neither always() nor !cancelled(): it is skipped, and reports success, when ${unrequired.length === 1 ? 'that job fails' : 'one of them fails'}.`;
  }

  const gates = [
    ...(SUCCESS_FUNCTION.test(job.condition) ? ['success()'] : []),
    ...unrequired
      .filter((need) => successGate(need).test(job.condition))
      .map((need) => `needs.${need}.result == 'success'`),
  ];
  if (gates.length > 0) {
    return `job '${job.id}' has ${gates.join(' and ')} in its 'if:', so it is skipped, and reports success, when an unrequired need fails, whatever always() or !cancelled() says.`;
  }

  const unread = unrequired.filter(
    (need) => !job.source.includes(`needs.${need}.result`) && !job.source.includes('needs.*.result'),
  );
  if (unread.length > 0) {
    return `job '${job.id}' runs after ${unread.join(', ')} but never reads needs.<job>.result, so it cannot fail when ${unread.length === 1 ? 'that job fails' : 'one of them fails'}.`;
  }

  return undefined;
}

/**
 * Every way `check` is unsound as a required status check, given the workflow
 * that is meant to produce it. All problems are returned so one run reports the
 * full picture instead of only the first failure.
 *
 * @param requiredContexts every context required from the same workflow; a need that reports one of
 * them gates itself, so a downstream job may be skipped when it fails.
 */
export function findRequiredCheckProblems(
  check: RequiredCheck,
  workflow: ParsedWorkflow | undefined,
  content: string | undefined,
  defaultBranch: string = DEFAULT_BRANCH,
  requiredContexts: readonly string[] = REQUIRED_CHECKS.filter((entry) => entry.workflow === check.workflow).map(
    (entry) => entry.context,
  ),
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
  // A commit status is POSTed to an explicit SHA, so a workflow_run evaluation can report it onto the
  // pull request head as well as a pull_request run can. That it does so for every pull request is
  // ci-required's anchor contract, which ci-required.test.ts holds; a job context has no such route.
  const reachesPullRequest = triggers.onPullRequest || (check.kind === 'status' && triggers.onWorkflowRun);
  if (!reachesPullRequest) {
    fail(
      check.kind === 'status'
        ? `${check.workflow} has neither an 'on.pull_request' nor an 'on.workflow_run' trigger, so the context never reports on a pull request.`
        : `${check.workflow} has no 'on.pull_request' trigger, so the context never reports on a pull request.`,
    );
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

    const unguarded = unguardedNeed(job, workflow, requiredContexts);
    if (unguarded !== undefined) {
      fail(unguarded);
    }
  }

  return problems;
}
