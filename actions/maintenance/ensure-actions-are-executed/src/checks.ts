import { errorMessage } from 'actions-util';

import type { RepositoryCoordinates } from 'actions-util';

/**
 * A check run, reduced to the fields the verification depends on.
 *
 * Workflow jobs are mapped onto the same shape by the fallback data source, so everything downstream
 * of the fetch is oblivious to where the records came from.
 */
export interface CheckRun {
  /** Monotonically increasing per re-run, which is what makes the latest attempt identifiable. */
  id: number;
  name: string;
  /** `queued`, `in_progress`, `completed`, … — reported verbatim by the API. */
  status: string;
  /** `null` until the check run completes. */
  conclusion: string | null;
  /** Link to the run, surfaced in the failure log so a human can jump straight to it. */
  detailsUrl: string | null;
}

/** Where a set of check runs came from. */
export type CheckDataSource = 'commit-check-runs' | 'workflow-run-jobs';

/** The repository operations this action needs, kept minimal so it can be faked in tests. */
export interface CheckRunsApi {
  /** Every check run reported for the given ref, across all pages. */
  listCheckRunsForRef(repository: RepositoryCoordinates, ref: string): Promise<CheckRun[]>;
  /** Every job of the given workflow run, mapped onto {@link CheckRun}, across all pages. */
  listWorkflowRunJobs(repository: RepositoryCoordinates, runId: number): Promise<CheckRun[]>;
}

export interface CollectRequest {
  repository: RepositoryCoordinates;
  /** Git reference (usually a SHA) whose check runs are inspected. */
  ref: string;
  /** Current workflow run, used by the fallback. `undefined` outside of a workflow run. */
  runId: number | undefined;
}

export interface CheckRunCollection {
  checkRuns: CheckRun[];
  source: CheckDataSource;
  /**
   * Why the workflow-jobs fallback contributed nothing, if it was attempted and did not work out.
   * Reported by the caller as a notice rather than thrown — see {@link collectCheckRuns}.
   */
  fallbackFailure?: string;
}

/** The check runs GitHub attached to the commit — the source this action is built around. */
const COMMIT_CHECK_RUNS: CheckDataSource = 'commit-check-runs';

/** The jobs of the current workflow run, standing in for check runs the commit does not have. */
const WORKFLOW_RUN_JOBS: CheckDataSource = 'workflow-run-jobs';

/** The outcome of the fallback: whatever it could read, or why it could not read anything. */
interface FallbackResult {
  checkRuns: CheckRun[];
  failure: string | undefined;
}

/**
 * Reads the jobs of the current workflow run, reporting rather than throwing any failure.
 *
 * Listing jobs needs the `actions:read` permission, which the documented token scope (`checks:read`)
 * does not include. A token without it must leave the action reporting "nothing started" — the
 * outcome for a genuinely empty ref — instead of failing the step over a permission the caller was
 * never asked to grant.
 */
async function collectWorkflowRunJobs(api: CheckRunsApi, request: CollectRequest): Promise<FallbackResult> {
  if (request.runId === undefined) {
    return {
      checkRuns: [],
      failure: 'GITHUB_RUN_ID is not set, so the workflow jobs fallback cannot identify a run.',
    };
  }

  try {
    return { checkRuns: await api.listWorkflowRunJobs(request.repository, request.runId), failure: undefined };
  } catch (error) {
    return {
      checkRuns: [],
      failure: `Workflow jobs fallback is unavailable (likely missing actions:read permission): ${errorMessage(error)}`,
    };
  }
}

/**
 * Collects the check runs to verify, preferring the ones GitHub attached to the commit.
 *
 * A commit carries no check runs at all when the workflow calling this action is the only one that
 * ever touched the ref. The workflow's own jobs are then the sole record of what ran, so they stand in
 * for check runs — best effort, see {@link collectWorkflowRunJobs}; the reason a fallback contributed
 * nothing is handed back to the caller to log.
 *
 * @throws whatever the check-runs API throws — a ref that cannot be read at all is a real failure and
 * must never be reported as "nothing started", which would pass every verification.
 */
export async function collectCheckRuns(api: CheckRunsApi, request: CollectRequest): Promise<CheckRunCollection> {
  const checkRuns = await api.listCheckRunsForRef(request.repository, request.ref);

  if (checkRuns.length > 0) {
    return { checkRuns, source: COMMIT_CHECK_RUNS };
  }

  const fallback = await collectWorkflowRunJobs(api, request);

  return fallback.checkRuns.length > 0
    ? { checkRuns: fallback.checkRuns, source: WORKFLOW_RUN_JOBS }
    : { checkRuns: [], fallbackFailure: fallback.failure, source: COMMIT_CHECK_RUNS };
}

/**
 * Reduces the check runs to the latest attempt per name, ordered by name.
 *
 * A re-run of a check keeps its name and gets a new, higher id, so a failed first attempt and its
 * successful re-run both appear in the response. Verifying the older one would fail a commit that has
 * since gone green.
 */
export function latestCheckRuns(checkRuns: CheckRun[]): CheckRun[] {
  const latestByName = new Map<string, CheckRun>();

  // `sort` is stable, so among equal ids the last one wins — the same tie-break as the shell
  // predecessor's `sort_by(.id) | group_by(.name) | map(.[-1])`.
  for (const checkRun of [...checkRuns].sort((left, right) => left.id - right.id)) {
    latestByName.set(checkRun.name, checkRun);
  }

  return [...latestByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
