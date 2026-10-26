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
    repos: {
      createOrUpdateFileContents: ReturnType<typeof vi.fn>;
      getContent: ReturnType<typeof vi.fn>;
    };
  };
}

/** Mirrors the shape of an Octokit `RequestError`, which carries the HTTP status. */
function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    rest: {
      git: { deleteRef: vi.fn(), getRef: vi.fn() },
      repos: { createOrUpdateFileContents: vi.fn(), getContent: vi.fn() },
    },
  };

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

describe('ScratchRepo.commitFile', () => {
  let octokit: OctokitMock;
  let scratch: ScratchRepo;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('E2E_GITHUB_TOKEN', 'ghs_test_token');
    vi.stubEnv('E2E_TEST_REPOSITORY', 'owner/repo');
    octokit = mockOctokit();
    scratch = ScratchRepo.fromEnvironment('unit');
    octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({ data: { commit: { sha: 'commit-sha' } } });
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'commit-sha' } } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a file the branch does not have, naming no blob', async () => {
    octokit.rest.repos.getContent.mockRejectedValue(httpError(404, 'Not Found'));

    await expect(scratch.commitFile('b', 'f.txt', 'x', 'm')).resolves.toBe('commit-sha');

    expect(octokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: 'owner',
      path: 'f.txt',
      ref: 'b',
      repo: 'repo',
    });
    expect(octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0]).not.toHaveProperty('sha');
  });

  // Without the blob SHA, GitHub answers 422 to any update of a file that already exists.
  it('replaces an existing file by naming the blob it replaces', async () => {
    octokit.rest.repos.getContent.mockResolvedValue({ data: { sha: 'blob-sha', type: 'file' } });

    await scratch.commitFile('b', 'f.txt', 'x', 'm');

    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'b', path: 'f.txt', sha: 'blob-sha' }),
    );
  });

  it('refuses to commit over a directory', async () => {
    octokit.rest.repos.getContent.mockResolvedValue({ data: [] });

    await expect(scratch.commitFile('b', 'dir', 'x', 'm')).rejects.toThrow('is not a file');
    expect(octokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it('propagates a lookup failure other than not found', async () => {
    octokit.rest.repos.getContent.mockRejectedValue(httpError(403, 'Forbidden'));

    await expect(scratch.commitFile('b', 'f.txt', 'x', 'm')).rejects.toThrow('Forbidden');
  });
});
