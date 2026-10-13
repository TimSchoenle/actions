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

describe('ScratchRepo.identifier', () => {
  beforeEach(() => {
    mockOctokit();
    vi.stubEnv('E2E_GITHUB_TOKEN', 'ghs_test_token');
    vi.stubEnv('E2E_TEST_REPOSITORY', 'owner/repo');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('scopes a case name to the suite and the run', () => {
    vi.stubEnv('GITHUB_RUN_ID', '123');
    vi.stubEnv('GITHUB_RUN_ATTEMPT', '2');

    expect(ScratchRepo.fromEnvironment('suite').identifier('create')).toBe('suite.123-2.create');
  });

  // Two runs reusing one identifier is the collision this exists to prevent.
  it('differs between two runs of the same suite', () => {
    vi.stubEnv('GITHUB_RUN_ID', '123');
    const first = ScratchRepo.fromEnvironment('suite').identifier('create');
    vi.stubEnv('GITHUB_RUN_ID', '124');
    const second = ScratchRepo.fromEnvironment('suite').identifier('create');

    expect(first).not.toBe(second);
  });
});

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
