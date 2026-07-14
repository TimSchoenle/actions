import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCheckRunsApi } from './github-api.js';

vi.mock('@actions/github');

const repository = { owner: 'owner', repo: 'repo' };

interface OctokitMock {
  rest: {
    actions: { listJobsForWorkflowRun: ReturnType<typeof vi.fn> };
    checks: { listForRef: ReturnType<typeof vi.fn> };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    rest: {
      actions: { listJobsForWorkflowRun: vi.fn() },
      checks: { listForRef: vi.fn() },
    },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

/** A raw check run as the REST API returns it, reduced to the fields the adapter reads. */
function rawCheckRun(id: number) {
  return {
    conclusion: 'success',
    details_url: `https://github.com/owner/repo/runs/${id}`,
    id,
    name: `check-${id}`,
    status: 'completed',
  };
}

function rawJob(id: number) {
  return {
    conclusion: null,
    html_url: `https://github.com/owner/repo/actions/runs/9/job/${id}`,
    id,
    name: `job-${id}`,
    status: 'in_progress',
  };
}

/** Splits the records into API pages of at most 100, the way the REST API paginates them. */
function paged<T>(records: T[]): (args: { page: number }) => { data: unknown } {
  return ({ page }) => ({
    data: {
      check_runs: records.slice((page - 1) * 100, page * 100),
      jobs: records.slice((page - 1) * 100, page * 100),
      total_count: records.length,
    },
  });
}

describe('createCheckRunsApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  it('maps a check run onto the domain model', async () => {
    octokit.rest.checks.listForRef.mockResolvedValue({ data: { check_runs: [rawCheckRun(1)], total_count: 1 } });

    await expect(createCheckRunsApi('token').listCheckRunsForRef(repository, 'sha')).resolves.toEqual([
      {
        conclusion: 'success',
        detailsUrl: 'https://github.com/owner/repo/runs/1',
        id: 1,
        name: 'check-1',
        status: 'completed',
      },
    ]);

    expect(octokit.rest.checks.listForRef).toHaveBeenCalledWith({
      owner: 'owner',
      page: 1,
      per_page: 100,
      ref: 'sha',
      repo: 'repo',
    });
  });

  it('reads every page of check runs and stops at the first short one', async () => {
    const records = Array.from({ length: 205 }, (_, index) => rawCheckRun(index + 1));
    octokit.rest.checks.listForRef.mockImplementation(paged(records));

    const checkRuns = await createCheckRunsApi('token').listCheckRunsForRef(repository, 'sha');

    expect(checkRuns).toHaveLength(205);
    expect(checkRuns.at(-1)?.name).toBe('check-205');
    expect(octokit.rest.checks.listForRef).toHaveBeenCalledTimes(3);
  });

  // A page count that is an exact multiple of the page size still needs the trailing empty page to
  // prove there is nothing left.
  it('requests one more page when the last page is full', async () => {
    const records = Array.from({ length: 100 }, (_, index) => rawCheckRun(index + 1));
    octokit.rest.checks.listForRef.mockImplementation(paged(records));

    await expect(createCheckRunsApi('token').listCheckRunsForRef(repository, 'sha')).resolves.toHaveLength(100);
    expect(octokit.rest.checks.listForRef).toHaveBeenCalledTimes(2);
  });

  it('reads no pages beyond an empty first one', async () => {
    octokit.rest.checks.listForRef.mockResolvedValue({ data: { check_runs: [], total_count: 0 } });

    await expect(createCheckRunsApi('token').listCheckRunsForRef(repository, 'sha')).resolves.toEqual([]);
    expect(octokit.rest.checks.listForRef).toHaveBeenCalledTimes(1);
  });

  it('maps a workflow job onto the domain model, using its html_url as the details link', async () => {
    octokit.rest.actions.listJobsForWorkflowRun.mockResolvedValue({ data: { jobs: [rawJob(5)], total_count: 1 } });

    await expect(createCheckRunsApi('token').listWorkflowRunJobs(repository, 9)).resolves.toEqual([
      {
        conclusion: null,
        detailsUrl: 'https://github.com/owner/repo/actions/runs/9/job/5',
        id: 5,
        name: 'job-5',
        status: 'in_progress',
      },
    ]);

    expect(octokit.rest.actions.listJobsForWorkflowRun).toHaveBeenCalledWith({
      owner: 'owner',
      page: 1,
      per_page: 100,
      repo: 'repo',
      run_id: 9,
    });
  });

  it('reads every page of workflow jobs', async () => {
    const records = Array.from({ length: 150 }, (_, index) => rawJob(index + 1));
    octokit.rest.actions.listJobsForWorkflowRun.mockImplementation(paged(records));

    await expect(createCheckRunsApi('token').listWorkflowRunJobs(repository, 9)).resolves.toHaveLength(150);
    expect(octokit.rest.actions.listJobsForWorkflowRun).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['listCheckRunsForRef', () => createCheckRunsApi('token').listCheckRunsForRef(repository, 'sha')],
    ['listWorkflowRunJobs', () => createCheckRunsApi('token').listWorkflowRunJobs(repository, 9)],
  ])('propagates an API error from %s', async (_name, call) => {
    const failure = Object.assign(new Error('Resource not accessible by integration'), { status: 403 });
    octokit.rest.checks.listForRef.mockRejectedValue(failure);
    octokit.rest.actions.listJobsForWorkflowRun.mockRejectedValue(failure);

    await expect(call()).rejects.toThrow('Resource not accessible by integration');
  });
});
