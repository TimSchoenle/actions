import { RATE_LIMIT_ANNOTATION_TITLE as CLIENT_ANNOTATION_TITLE } from 'actions-util/client';
import { describe, expect, it } from 'vitest';

import {
  budgetHasRecovered,
  DEFAULT_SWEEP_POLICY,
  isRateLimitFailure,
  limitReruns,
  RATE_LIMIT_ANNOTATION_TITLE,
  resetWaitMs,
  selectRuns,
  skipReason,
  sweep,
  type GitHubApi,
  type JobAnnotation,
  type RateLimitSnapshot,
  type SweepPolicy,
  type WorkflowRun,
} from '../lib/rate-limit-rerun.js';

const NOW_MS = 1_700_000_000_000;

const POLICY: SweepPolicy = {
  watchedWorkflows: ['Update Files'],
  maxAttempts: 3,
  lookbackMs: 60 * 60 * 1_000,
  maxInspectedRuns: 5,
  maxRerunsPerSweep: 2,
  minBudgetFraction: 0.2,
};

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 1,
    name: 'Update Files',
    attempt: 1,
    createdAtMs: NOW_MS - 60_000,
    headBranch: 'feature',
    ...overrides,
  };
}

function annotation(overrides: Partial<JobAnnotation> = {}): JobAnnotation {
  return { level: 'failure', title: '', message: 'boom', ...overrides };
}

function snapshot(overrides: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot {
  return { limit: 5_000, remaining: 5_000, resetEpochSeconds: NOW_MS / 1_000 + 600, ...overrides };
}

interface FakeApi extends GitHubApi {
  /** Run ids the sweep actually asked GitHub to restart. */
  rerun: number[];
  /** How often each read was reached for, so a test can assert that one was never made. */
  calls: { listFailedRuns: number; annotationsOf: number };
}

/** A recording `GitHubApi` whose every answer is fixed up front. */
function fakeApi(
  overrides: Partial<{
    budget: RateLimitSnapshot;
    runs: WorkflowRun[];
    failedJobs: Record<number, number[]>;
    annotations: Record<number, JobAnnotation[]>;
    rerunFails: ReadonlySet<number>;
  }> = {},
): FakeApi {
  const { annotations = {}, budget, failedJobs = {}, rerunFails = new Set<number>(), runs = [] } = overrides;
  const rerun: number[] = [];
  const calls = { listFailedRuns: 0, annotationsOf: 0 };

  return {
    rerun,
    calls,
    budget: () => Promise.resolve(budget),
    listFailedRuns: () => {
      calls.listFailedRuns += 1;

      return Promise.resolve(runs);
    },
    listFailedJobIds: (runId) => Promise.resolve(failedJobs[runId] ?? []),
    annotationsOf: (jobId) => {
      calls.annotationsOf += 1;

      return Promise.resolve(annotations[jobId] ?? []);
    },
    rerunFailedJobs: (runId) => {
      if (rerunFails.has(runId)) {
        return Promise.reject(new Error('branch was deleted'));
      }

      rerun.push(runId);

      return Promise.resolve();
    },
  };
}

// The whole sweep hangs off recognising one failure out of every way a job can go red, so this is the
// classifier that must never guess.
describe('isRateLimitFailure', () => {
  it('recognises the titled annotation the shared client writes', () => {
    expect(isRateLimitFailure([annotation({ title: RATE_LIMIT_ANNOTATION_TITLE })])).toBe(true);
  });

  // Actions are pinned by released tag, so a job can still be running a build that predates the title.
  it.each([
    'Request failed due to following response errors:\n - API rate limit already exceeded for installation ID 1.',
    'You have exceeded a secondary rate limit and have been temporarily blocked.',
  ])('falls back to GitHub’s own wording: %s', (message) => {
    expect(isRateLimitFailure([annotation({ message })])).toBe(true);
  });

  it('ignores a warning that merely mentions rate limits', () => {
    expect(isRateLimitFailure([annotation({ level: 'warning', message: 'approaching the rate limit' })])).toBe(false);
  });

  it('does not mistake an ordinary failure for one', () => {
    expect(isRateLimitFailure([annotation({ message: 'Process completed with exit code 1.' })])).toBe(false);
  });

  it('says no when there are no annotations at all', () => {
    expect(isRateLimitFailure([])).toBe(false);
  });

  // The title is written by `packages/ts-util/src/github-client.ts` and matched here; the two are
  // deliberately not one import, so nothing but this assertion keeps them in step.
  it('matches the title the client actually writes', () => {
    expect(RATE_LIMIT_ANNOTATION_TITLE).toBe(CLIENT_ANNOTATION_TITLE);
  });
});

describe('budgetHasRecovered', () => {
  it('waits while the budget is still mostly spent', () => {
    expect(budgetHasRecovered(snapshot({ remaining: 100 }), POLICY)).toBe(false);
  });

  it('goes once the free share reaches the threshold', () => {
    expect(budgetHasRecovered(snapshot({ remaining: 1_000 }), POLICY)).toBe(true);
  });

  // A limit of zero is a snapshot that told us nothing, not a budget that is entirely free.
  it('treats an empty snapshot as "not yet", never as "all clear"', () => {
    expect(budgetHasRecovered(snapshot({ limit: 0, remaining: 0 }), POLICY)).toBe(false);
  });
});

describe('resetWaitMs', () => {
  it('reports how long the window still has to run', () => {
    expect(resetWaitMs(snapshot({ resetEpochSeconds: NOW_MS / 1_000 + 90 }), NOW_MS)).toBe(90_000);
  });

  it('floors a reset already behind us at zero', () => {
    expect(resetWaitMs(snapshot({ resetEpochSeconds: 1 }), NOW_MS)).toBe(0);
  });
});

describe('skipReason', () => {
  it('accepts a recent failure of a watched workflow', () => {
    expect(skipReason(run(), POLICY, NOW_MS)).toBeUndefined();
  });

  it('refuses a workflow the sweep was not told to re-run', () => {
    expect(skipReason(run({ name: 'CodeQL' }), POLICY, NOW_MS)).toContain('not one the sweep re-runs');
  });

  it('refuses a run that has already been re-tried to the cap', () => {
    expect(skipReason(run({ attempt: 3 }), POLICY, NOW_MS)).toContain('attempt 3 of 3');
  });

  it('refuses a run older than the lookback window', () => {
    expect(skipReason(run({ createdAtMs: NOW_MS - 2 * 60 * 60 * 1_000 }), POLICY, NOW_MS)).toContain('lookback window');
  });
});

describe('selectRuns', () => {
  it('keeps only the newest run per workflow and branch', () => {
    const older = run({ id: 1, createdAtMs: NOW_MS - 600_000 });
    const newer = run({ id: 2, createdAtMs: NOW_MS - 60_000 });

    const { selected, skipped } = selectRuns([older, newer], POLICY, NOW_MS);

    expect(selected.map((entry) => entry.id)).toEqual([2]);
    expect(skipped).toEqual([{ run: older, reason: expect.stringContaining('superseded') }]);
  });

  it('separates runs on different branches of the same workflow', () => {
    const runs = [run({ id: 1, headBranch: 'a' }), run({ id: 2, headBranch: 'b' })];

    expect(selectRuns(runs, POLICY, NOW_MS).selected).toHaveLength(2);
  });

  // Two runs created in the same second must not have their fate decided by API ordering.
  it('breaks a timestamp tie by id, not by input order', () => {
    const first = run({ id: 7, createdAtMs: NOW_MS });
    const second = run({ id: 8, createdAtMs: NOW_MS });

    expect(selectRuns([first, second], POLICY, NOW_MS).selected.map((entry) => entry.id)).toEqual([8]);
    expect(selectRuns([second, first], POLICY, NOW_MS).selected.map((entry) => entry.id)).toEqual([8]);
  });

  it('orders what it keeps newest first', () => {
    const runs = [
      run({ id: 1, createdAtMs: NOW_MS - 300_000, headBranch: 'a' }),
      run({ id: 2, createdAtMs: NOW_MS - 60_000, headBranch: 'b' }),
      run({ id: 3, createdAtMs: NOW_MS - 120_000, headBranch: 'c' }),
    ];

    expect(selectRuns(runs, POLICY, NOW_MS).selected.map((entry) => entry.id)).toEqual([2, 3, 1]);
  });

  it('reports every run it drops for the inspection budget instead of dropping it silently', () => {
    const runs = Array.from({ length: 7 }, (_, index) =>
      run({ id: index + 1, headBranch: `b${index}`, createdAtMs: NOW_MS - index * 1_000 }),
    );

    const { selected, skipped } = selectRuns(runs, POLICY, NOW_MS);

    expect(selected).toHaveLength(POLICY.maxInspectedRuns);
    expect(skipped.map((entry) => entry.reason)).toEqual([
      expect.stringContaining('inspection budget'),
      expect.stringContaining('inspection budget'),
    ]);
  });
});

describe('limitReruns', () => {
  it('re-runs the newest first when there are more than one sweep may take', () => {
    const runs = [
      run({ id: 1, createdAtMs: NOW_MS - 300_000 }),
      run({ id: 2, createdAtMs: NOW_MS - 60_000 }),
      run({ id: 3, createdAtMs: NOW_MS - 120_000 }),
    ];

    const { selected, skipped } = limitReruns(runs, POLICY);

    expect(selected.map((entry) => entry.id)).toEqual([2, 3]);
    expect(skipped).toEqual([{ run: runs[0], reason: expect.stringContaining('2-run limit') }]);
  });
});

describe('sweep', () => {
  const RATE_LIMITED = [annotation({ title: RATE_LIMIT_ANNOTATION_TITLE })];

  it('re-runs a run whose only failed job was refused for rate limiting', async () => {
    const api = fakeApi({
      budget: snapshot(),
      runs: [run({ id: 10 })],
      failedJobs: { 10: [99] },
      annotations: { 99: RATE_LIMITED },
    });

    const result = await sweep(api, POLICY, NOW_MS, { dryRun: false });

    expect(api.rerun).toEqual([10]);
    expect(result.rerun.map((entry) => entry.id)).toEqual([10]);
    expect(result.unrelated).toEqual([]);
  });

  // The whole point of the budget gate: re-running into a spent budget reproduces the failure and
  // spends one of the run's remaining attempts to do it.
  it('stands down without reading anything while the budget is still spent', async () => {
    const api = fakeApi({ budget: snapshot({ remaining: 10 }), runs: [run({ id: 10 })] });

    const result = await sweep(api, POLICY, NOW_MS, { dryRun: false });

    expect(result.deferred).toContain('10 of 5000');
    expect(result.rerun).toEqual([]);
    expect(api.calls.listFailedRuns).toBe(0);
    expect(api.rerun).toEqual([]);
  });

  it('proceeds when no probe token made a budget reading possible', async () => {
    const api = fakeApi({
      runs: [run({ id: 10 })],
      failedJobs: { 10: [99] },
      annotations: { 99: RATE_LIMITED },
    });

    const result = await sweep(api, POLICY, NOW_MS, { dryRun: false });

    expect(result.deferred).toBeUndefined();
    expect(api.rerun).toEqual([10]);
  });

  it('leaves a run alone when one of its failed jobs failed for a real reason', async () => {
    const api = fakeApi({
      budget: snapshot(),
      runs: [run({ id: 10 })],
      failedJobs: { 10: [98, 99] },
      annotations: { 98: RATE_LIMITED, 99: [annotation({ message: 'Process completed with exit code 1.' })] },
    });

    const result = await sweep(api, POLICY, NOW_MS, { dryRun: false });

    expect(api.rerun).toEqual([]);
    expect(result.unrelated.map((entry) => entry.id)).toEqual([10]);
  });

  // "Every failed job" is vacuously true of no jobs at all; a cancelled run must not slip through it.
  it('leaves a failed run with no failed jobs alone', async () => {
    const api = fakeApi({ budget: snapshot(), runs: [run({ id: 10 })], failedJobs: { 10: [] } });

    await sweep(api, POLICY, NOW_MS, { dryRun: false });

    expect(api.rerun).toEqual([]);
  });

  it('reports what it would do without doing it when asked for a dry run', async () => {
    const api = fakeApi({
      budget: snapshot(),
      runs: [run({ id: 10 })],
      failedJobs: { 10: [99] },
      annotations: { 99: RATE_LIMITED },
    });

    const result = await sweep(api, POLICY, NOW_MS, { dryRun: true });

    expect(result.rerun.map((entry) => entry.id)).toEqual([10]);
    expect(api.rerun).toEqual([]);
  });

  it('carries on past a re-run the API refused, and reports it', async () => {
    const api = fakeApi({
      budget: snapshot(),
      runs: [run({ id: 10, headBranch: 'a' }), run({ id: 11, headBranch: 'b', createdAtMs: NOW_MS - 30_000 })],
      failedJobs: { 10: [98], 11: [99] },
      annotations: { 98: RATE_LIMITED, 99: RATE_LIMITED },
      rerunFails: new Set([10]),
    });

    const result = await sweep(api, POLICY, NOW_MS, { dryRun: false });

    expect(api.rerun).toEqual([11]);
    expect(result.failed).toEqual([{ run: expect.objectContaining({ id: 10 }), reason: 'branch was deleted' }]);
  });

  // Reading annotations costs API calls, so the cheap filters have to run first.
  it('reads no annotations for a run the cheap filters already ruled out', async () => {
    const api = fakeApi({
      budget: snapshot(),
      runs: [run({ id: 10, name: 'CodeQL' })],
      failedJobs: { 10: [99] },
      annotations: { 99: RATE_LIMITED },
    });

    await sweep(api, POLICY, NOW_MS, { dryRun: false });

    expect(api.calls.annotationsOf).toBe(0);
    expect(api.rerun).toEqual([]);
  });
});

describe('DEFAULT_SWEEP_POLICY', () => {
  it('is bounded on every axis the sweep can run away on', () => {
    expect(DEFAULT_SWEEP_POLICY.watchedWorkflows.length).toBeGreaterThan(0);
    expect(DEFAULT_SWEEP_POLICY.maxAttempts).toBeGreaterThan(1);
    expect(DEFAULT_SWEEP_POLICY.lookbackMs).toBeGreaterThan(0);
    // Inspecting fewer runs than may be re-run would make the re-run limit unreachable.
    expect(DEFAULT_SWEEP_POLICY.maxInspectedRuns).toBeGreaterThanOrEqual(DEFAULT_SWEEP_POLICY.maxRerunsPerSweep);
    expect(DEFAULT_SWEEP_POLICY.minBudgetFraction).toBeGreaterThan(0);
    expect(DEFAULT_SWEEP_POLICY.minBudgetFraction).toBeLessThan(1);
  });
});
