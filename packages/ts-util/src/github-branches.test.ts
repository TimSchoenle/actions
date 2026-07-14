import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBranchApi } from './github-branches.js';

vi.mock('@actions/github');

const repository = { owner: 'owner', repo: 'repo' };

interface OctokitMock {
  rest: {
    git: {
      createRef: ReturnType<typeof vi.fn>;
      deleteRef: ReturnType<typeof vi.fn>;
      getRef: ReturnType<typeof vi.fn>;
      updateRef: ReturnType<typeof vi.fn>;
    };
    repos: {
      get: ReturnType<typeof vi.fn>;
    };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    rest: {
      git: { createRef: vi.fn(), deleteRef: vi.fn(), getRef: vi.fn(), updateRef: vi.fn() },
      repos: { get: vi.fn() },
    },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

/** Mirrors the shape of an Octokit `RequestError`, which carries the HTTP status. */
function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** Every failure that must never be mistaken for a resource that does not exist. */
const NOT_ABSENCE = [
  [401, 'Bad credentials'],
  [403, 'Resource not accessible by integration'],
  [500, 'Server error'],
] as const;

describe('createBranchApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  describe('getDefaultBranch', () => {
    it('reads the default branch from the repository', async () => {
      octokit.rest.repos.get.mockResolvedValue({ data: { default_branch: 'trunk' } });

      await expect(createBranchApi('token').getDefaultBranch(repository)).resolves.toBe('trunk');
      expect(octokit.rest.repos.get).toHaveBeenCalledWith(repository);
    });
  });

  describe('branchExists', () => {
    // The exact-match endpoint: the plural one prefix-matches, so 'feat' would come back as existing
    // whenever 'feature/x' does — and the delete or reset that follows would hit the wrong branch.
    it('probes the exact ref', async () => {
      octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'abc123' } } });

      await expect(createBranchApi('token').branchExists(repository, 'main')).resolves.toBe(true);
      expect(octokit.rest.git.getRef).toHaveBeenCalledWith({ ...repository, ref: 'heads/main' });
    });

    it('translates a 404 into a branch that does not exist', async () => {
      octokit.rest.git.getRef.mockRejectedValue(httpError(404, 'Not Found'));

      await expect(createBranchApi('token').branchExists(repository, 'gone')).resolves.toBe(false);
    });

    it.each(NOT_ABSENCE)('propagates a %i response instead of reporting a missing branch', async (status, message) => {
      octokit.rest.git.getRef.mockRejectedValue(httpError(status, message));

      await expect(createBranchApi('token').branchExists(repository, 'main')).rejects.toThrow(message);
    });
  });

  describe('getBranchSha', () => {
    it('reads the head commit of a branch from its ref', async () => {
      octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'abc123' } } });

      await expect(createBranchApi('token').getBranchSha(repository, 'main')).resolves.toBe('abc123');
      expect(octokit.rest.git.getRef).toHaveBeenCalledWith({ ...repository, ref: 'heads/main' });
    });

    it('translates a 404 into a branch that does not exist', async () => {
      octokit.rest.git.getRef.mockRejectedValue(httpError(404, 'Not Found'));

      await expect(createBranchApi('token').getBranchSha(repository, 'gone')).resolves.toBeUndefined();
    });

    it.each(NOT_ABSENCE)('propagates a %i response instead of reporting a missing branch', async (status, message) => {
      octokit.rest.git.getRef.mockRejectedValue(httpError(status, message));

      await expect(createBranchApi('token').getBranchSha(repository, 'main')).rejects.toThrow(message);
    });

    it('propagates a transport error without a status', async () => {
      octokit.rest.git.getRef.mockRejectedValue(new Error('socket hang up'));

      await expect(createBranchApi('token').getBranchSha(repository, 'main')).rejects.toThrow('socket hang up');
    });
  });

  describe('createBranch', () => {
    it('creates a branch as a fully qualified ref', async () => {
      octokit.rest.git.createRef.mockResolvedValue({ data: {} });

      await createBranchApi('token').createBranch(repository, 'feature', 'abc123');

      expect(octokit.rest.git.createRef).toHaveBeenCalledWith({
        ...repository,
        ref: 'refs/heads/feature',
        sha: 'abc123',
      });
    });
  });

  describe('resetBranch', () => {
    it('resets a branch with a forced ref update', async () => {
      octokit.rest.git.updateRef.mockResolvedValue({ data: {} });

      await createBranchApi('token').resetBranch(repository, 'feature', 'abc123');

      expect(octokit.rest.git.updateRef).toHaveBeenCalledWith({
        ...repository,
        force: true,
        ref: 'heads/feature',
        sha: 'abc123',
      });
    });
  });

  describe('deleteBranch', () => {
    it('deletes the exact ref', async () => {
      octokit.rest.git.deleteRef.mockResolvedValue({ data: {} });

      await createBranchApi('token').deleteBranch(repository, 'feature');

      expect(octokit.rest.git.deleteRef).toHaveBeenCalledWith({ ...repository, ref: 'heads/feature' });
    });

    // A rejected deletion is the caller's decision to interpret — a protected branch is a warning in
    // one action and a failure in another — so this layer must not swallow it.
    it('propagates a rejected deletion', async () => {
      octokit.rest.git.deleteRef.mockRejectedValue(httpError(422, 'Reference does not exist'));

      await expect(createBranchApi('token').deleteBranch(repository, 'protected')).rejects.toThrow(
        'Reference does not exist',
      );
    });
  });

  it.each([
    ['createBranch', 422, 'Reference already exists'],
    ['resetBranch', 422, 'Update is not a fast forward'],
  ] as const)('propagates a failing %s', async (method, status, message) => {
    octokit.rest.git.createRef.mockRejectedValue(httpError(status, message));
    octokit.rest.git.updateRef.mockRejectedValue(httpError(status, message));

    await expect(createBranchApi('token')[method](repository, 'feature', 'abc123')).rejects.toThrow(message);
  });
});
