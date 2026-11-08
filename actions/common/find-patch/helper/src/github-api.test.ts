import { createOctokit } from 'actions-util/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RunNotFoundError } from './find.js';
import { createArtifactApi } from './github-api.js';

vi.mock('actions-util/client', () => ({ createOctokit: vi.fn() }));

const repository = { owner: 'owner', repo: 'repo' };

interface OctokitMock {
  paginate: ReturnType<typeof vi.fn>;
  rest: { actions: { listWorkflowRunArtifacts: ReturnType<typeof vi.fn> } };
}

/** Mirrors the shape of an Octokit `RequestError`, which carries the HTTP status. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe('createArtifactApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.resetAllMocks();
    octokit = { paginate: vi.fn(), rest: { actions: { listWorkflowRunArtifacts: vi.fn() } } };
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);
  });

  it('creates its client with the token it was given', () => {
    createArtifactApi('the-token');

    expect(createOctokit).toHaveBeenCalledWith('the-token');
  });

  it('lists every page of the run artifacts filtered by name, keeping id, name and expiry', async () => {
    octokit.paginate.mockResolvedValue([
      { expired: false, id: 1, name: 'patch', size_in_bytes: 10 },
      { expired: true, id: 2, name: 'patch', size_in_bytes: 10 },
    ]);

    const artifacts = await createArtifactApi('t').listArtifacts(repository, 42, 'patch');

    expect(octokit.paginate).toHaveBeenCalledWith(octokit.rest.actions.listWorkflowRunArtifacts, {
      name: 'patch',
      owner: 'owner',
      per_page: 100,
      repo: 'repo',
      run_id: 42,
    });
    expect(artifacts).toEqual([
      { expired: false, id: 1, name: 'patch', sizeInBytes: 10 },
      { expired: true, id: 2, name: 'patch', sizeInBytes: 10 },
    ]);
  });

  it('reports a run that does not exist, or that the token may not see, as RunNotFoundError', async () => {
    const cause = httpError(404, 'Not Found');
    octokit.paginate.mockRejectedValue(cause);

    const failure = createArtifactApi('t').listArtifacts(repository, 42, 'patch');

    await expect(failure).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(failure).rejects.toMatchObject({
      cause,
      message: expect.stringContaining('Workflow run 42 of owner/repo was not found'),
    });
  });

  it('reports a 422 with the run, repository and artifact name, keeping the cause', async () => {
    const cause = httpError(422, 'Validation Failed');
    octokit.paginate.mockRejectedValue(cause);

    const failure = createArtifactApi('t').listArtifacts(repository, 42, 'patch');

    await expect(failure).rejects.toMatchObject({
      cause,
      message:
        'GitHub refused to list the artifacts named "patch" of workflow run 42 of owner/repo (422): Validation Failed',
    });
  });

  it.each([401, 403, 500])('passes a %i through unchanged rather than reading it as a missing run', async (status) => {
    const error = httpError(status, 'refused');
    octokit.paginate.mockRejectedValue(error);

    await expect(createArtifactApi('t').listArtifacts(repository, 42, 'patch')).rejects.toBe(error);
  });
});
