import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBranchApi } from './github-api.js';

vi.mock('@actions/github');

const repository = { owner: 'owner', repo: 'repo' };

interface OctokitMock {
  rest: {
    git: {
      deleteRef: ReturnType<typeof vi.fn>;
      getRef: ReturnType<typeof vi.fn>;
    };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    rest: { git: { deleteRef: vi.fn(), getRef: vi.fn() } },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

/** Mirrors the shape of an Octokit `RequestError`, which carries the HTTP status. */
function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

describe('createBranchApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  it('probes the exact branch ref, not its prefix', async () => {
    octokit.rest.git.getRef.mockResolvedValue({ data: { ref: 'refs/heads/main' } });

    await expect(createBranchApi('token').branchExists(repository, 'main')).resolves.toBe(true);
    expect(octokit.rest.git.getRef).toHaveBeenCalledWith({ ...repository, ref: 'heads/main' });
  });

  it('translates a 404 into a missing branch', async () => {
    octokit.rest.git.getRef.mockRejectedValue(httpError(404, 'Not Found'));

    await expect(createBranchApi('token').branchExists(repository, 'gone')).resolves.toBe(false);
  });

  it.each([
    [401, 'Bad credentials'],
    [403, 'Resource not accessible by integration'],
    [500, 'Server error'],
  ])('propagates a %i response instead of reporting a missing branch', async (status, message) => {
    octokit.rest.git.getRef.mockRejectedValue(httpError(status, message));

    await expect(createBranchApi('token').branchExists(repository, 'main')).rejects.toThrow(message);
  });

  it('propagates a transport error without a status', async () => {
    octokit.rest.git.getRef.mockRejectedValue(new Error('socket hang up'));

    await expect(createBranchApi('token').branchExists(repository, 'main')).rejects.toThrow('socket hang up');
  });

  it('deletes the branch ref', async () => {
    octokit.rest.git.deleteRef.mockResolvedValue({ status: 204 });

    await expect(createBranchApi('token').deleteBranch(repository, 'feature/x')).resolves.toBeUndefined();
    expect(octokit.rest.git.deleteRef).toHaveBeenCalledWith({ ...repository, ref: 'heads/feature/x' });
  });

  // Whether a rejected deletion is fatal is decided in the domain, so this layer must not swallow it.
  it('propagates a rejected deletion', async () => {
    octokit.rest.git.deleteRef.mockRejectedValue(httpError(422, 'Reference does not exist'));

    await expect(createBranchApi('token').deleteBranch(repository, 'main')).rejects.toThrow('Reference does not exist');
  });
});
