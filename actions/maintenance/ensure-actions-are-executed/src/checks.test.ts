import { describe, expect, it, vi } from 'vitest';

import { collectCheckRuns, latestCheckRuns } from './checks.js';

import type { CheckRun, CheckRunsApi } from './checks.js';

const repository = { owner: 'owner', repo: 'repo' };

function checkRun(overrides: Partial<CheckRun> & Pick<CheckRun, 'id' | 'name'>): CheckRun {
  return {
    conclusion: 'success',
    detailsUrl: `https://github.com/owner/repo/runs/${overrides.id}`,
    status: 'completed',
    ...overrides,
  };
}

function fakeApi(checkRuns: CheckRun[] = [], jobs: CheckRun[] | Error = []): CheckRunsApi {
  return {
    listCheckRunsForRef: vi.fn(async () => checkRuns),
    listWorkflowRunJobs: vi.fn(async () => {
      if (jobs instanceof Error) {
        throw jobs;
      }
      return jobs;
    }),
  };
}

describe('collectCheckRuns', () => {
  const request = { ref: 'deadbeef', repository, runId: 42 };

  it('uses the commit check runs and does not touch the fallback', async () => {
    const api = fakeApi([checkRun({ id: 1, name: 'build' })]);

    const collection = await collectCheckRuns(api, request);

    expect(collection.source).toBe('commit-check-runs');
    expect(collection.checkRuns).toHaveLength(1);
    expect(collection.fallbackFailure).toBeUndefined();
    expect(api.listCheckRunsForRef).toHaveBeenCalledWith(repository, 'deadbeef');
    expect(api.listWorkflowRunJobs).not.toHaveBeenCalled();
  });

  it('falls back to the workflow jobs when the commit has no check runs', async () => {
    const api = fakeApi([], [checkRun({ id: 7, name: 'test' })]);

    const collection = await collectCheckRuns(api, request);

    expect(collection.source).toBe('workflow-run-jobs');
    expect(collection.checkRuns).toEqual([checkRun({ id: 7, name: 'test' })]);
    expect(api.listWorkflowRunJobs).toHaveBeenCalledWith(repository, 42);
  });

  it('stays on the commit source when the fallback returns no jobs either', async () => {
    const collection = await collectCheckRuns(fakeApi([], []), request);

    expect(collection.source).toBe('commit-check-runs');
    expect(collection.checkRuns).toEqual([]);
    expect(collection.fallbackFailure).toBeUndefined();
  });

  // The documented token scope is checks:read, which cannot list jobs. A caller who did not grant
  // actions:read must still get the "nothing started" outcome instead of a failed step.
  it('reports a failing fallback instead of propagating it', async () => {
    const api = fakeApi([], new Error('Resource not accessible by integration'));

    const collection = await collectCheckRuns(api, request);

    expect(collection.checkRuns).toEqual([]);
    expect(collection.source).toBe('commit-check-runs');
    expect(collection.fallbackFailure).toContain('Resource not accessible by integration');
    expect(collection.fallbackFailure).toContain('actions:read');
  });

  it('skips the fallback when no workflow run is identifiable', async () => {
    const api = fakeApi([], [checkRun({ id: 7, name: 'test' })]);

    const collection = await collectCheckRuns(api, { ...request, runId: undefined });

    expect(collection.checkRuns).toEqual([]);
    expect(collection.fallbackFailure).toContain('GITHUB_RUN_ID');
    expect(api.listWorkflowRunJobs).not.toHaveBeenCalled();
  });

  // A ref that cannot be read at all is a real failure: reporting it as "nothing started" would let
  // a bad token pass every verification.
  it('propagates a failing check-runs listing', async () => {
    const api: CheckRunsApi = {
      listCheckRunsForRef: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
      listWorkflowRunJobs: vi.fn(async () => []),
    };

    await expect(collectCheckRuns(api, request)).rejects.toThrow('Bad credentials');
  });
});

describe('latestCheckRuns', () => {
  it('keeps the highest id per name, regardless of input order', () => {
    const runs = [
      checkRun({ conclusion: 'failure', id: 3, name: 'build' }),
      checkRun({ id: 10, name: 'build' }),
      checkRun({ id: 1, name: 'lint' }),
    ];

    expect(latestCheckRuns(runs).map((run) => [run.name, run.id, run.conclusion])).toEqual([
      ['build', 10, 'success'],
      ['lint', 1, 'success'],
    ]);
  });

  it('orders the snapshot by name', () => {
    const runs = [checkRun({ id: 1, name: 'zeta' }), checkRun({ id: 2, name: 'alpha' })];

    expect(latestCheckRuns(runs).map((run) => run.name)).toEqual(['alpha', 'zeta']);
  });

  it('does not mutate its input', () => {
    const runs = [checkRun({ id: 2, name: 'b' }), checkRun({ id: 1, name: 'a' })];

    latestCheckRuns(runs);

    expect(runs.map((run) => run.id)).toEqual([2, 1]);
  });

  it('returns nothing for no check runs', () => {
    expect(latestCheckRuns([])).toEqual([]);
  });
});
