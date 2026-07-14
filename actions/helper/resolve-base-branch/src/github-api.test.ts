import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBranchApi } from './github-api.js';

vi.mock('@actions/github');

const repository = { owner: 'owner', repo: 'repo' };

interface OctokitMock {
  rest: {
    repos: {
      get: ReturnType<typeof vi.fn>;
      getBranch: ReturnType<typeof vi.fn>;
    };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    rest: { repos: { get: vi.fn(), getBranch: vi.fn() } },
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

  it('reads the default branch from the repository', async () => {
    octokit.rest.repos.get.mockResolvedValue({ data: { default_branch: 'trunk' } });

    await expect(createBranchApi('token').getDefaultBranch(repository)).resolves.toBe('trunk');
    expect(octokit.rest.repos.get).toHaveBeenCalledWith(repository);
  });

  it('reports an existing branch', async () => {
    octokit.rest.repos.getBranch.mockResolvedValue({ data: { name: 'main' } });

    await expect(createBranchApi('token').branchExists(repository, 'main')).resolves.toBe(true);
    expect(octokit.rest.repos.getBranch).toHaveBeenCalledWith({ ...repository, branch: 'main' });
  });

  it('translates a 404 into a missing branch', async () => {
    octokit.rest.repos.getBranch.mockRejectedValue(httpError(404, 'Branch not found'));

    await expect(createBranchApi('token').branchExists(repository, 'gone')).resolves.toBe(false);
  });

  it.each([
    [401, 'Bad credentials'],
    [403, 'Resource not accessible by integration'],
    [500, 'Server error'],
  ])('propagates a %i response instead of reporting a missing branch', async (status, message) => {
    octokit.rest.repos.getBranch.mockRejectedValue(httpError(status, message));

    await expect(createBranchApi('token').branchExists(repository, 'main')).rejects.toThrow(message);
  });

  it('propagates a transport error without a status', async () => {
    octokit.rest.repos.getBranch.mockRejectedValue(new Error('socket hang up'));

    await expect(createBranchApi('token').branchExists(repository, 'main')).rejects.toThrow('socket hang up');
  });
});
