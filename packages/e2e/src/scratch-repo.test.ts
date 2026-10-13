import { createOctokit } from 'actions-util/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScratchRepo } from './scratch-repo.js';

vi.mock('actions-util/client');

interface OctokitMock {
  rest: {
    git: {
      deleteRef: ReturnType<typeof vi.fn>;
      getRef: ReturnType<typeof vi.fn>;
    };
  };
}

/** Mirrors the shape of an Octokit `RequestError`, which carries the HTTP status. */
function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = { rest: { git: { deleteRef: vi.fn(), getRef: vi.fn() } } };

  vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

  return octokit;
}

describe('ScratchRepo.removeBranch', () => {
  let octokit: OctokitMock;
  let scratch: ScratchRepo;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('E2E_GITHUB_TOKEN', 'ghs_test_token');
    vi.stubEnv('E2E_TEST_REPOSITORY', 'owner/repo');
    octokit = mockOctokit();
    scratch = ScratchRepo.fromEnvironment('unit');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves once the branch is deleted and no longer readable', async () => {
    const branch = scratch.branch('remove');
    octokit.rest.git.deleteRef.mockResolvedValue({});
    octokit.rest.git.getRef.mockRejectedValue(httpError(404, 'Not Found'));

    await expect(scratch.removeBranch(branch)).resolves.toBeUndefined();
    expect(octokit.rest.git.deleteRef).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', ref: `heads/${branch}` });
  });

  it('throws when the delete is refused, naming the branch', async () => {
    const branch = scratch.branch('refused');
    octokit.rest.git.deleteRef.mockRejectedValue(httpError(403, 'Resource not accessible by integration'));

    await expect(scratch.removeBranch(branch)).rejects.toThrow(
      `Failed to delete branch ${branch}: Resource not accessible by integration`,
    );
  });
});
