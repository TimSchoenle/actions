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

  // C6: the janitor reads a ref's age from its name, so a branch created now at an old commit is not
  // mistaken for a stale one and swept while its run is still going.
  it('scopes a case name to the suite and the run, which starts with its creation time', () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-12T10:00:00Z') });
    vi.stubEnv('GITHUB_RUN_ID', '123');
    vi.stubEnv('GITHUB_RUN_ATTEMPT', '2');

    try {
      const scratch = ScratchRepo.fromEnvironment('suite');

      expect(scratch.identifier('create')).toBe('suite.1794477600-123-2.create');
      expect(scratch.branch('create')).toBe('test/suite/1794477600-123-2/create');
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a local run with its creation time too', () => {
    vi.stubEnv('GITHUB_RUN_ID', undefined);

    expect(ScratchRepo.fromEnvironment('suite').branch('x')).toMatch(/^test\/suite\/\d{10}-local-[0-9a-f]{8}\/x$/);
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

describe('ScratchRepo tags', () => {
  let octokit: OctokitMock & { paginate: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> };
  let scratch: ScratchRepo;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('E2E_GITHUB_TOKEN', 'ghs_test_token');
    vi.stubEnv('E2E_TEST_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_RUN_ID', '9');
    vi.stubEnv('GITHUB_RUN_ATTEMPT', '1');
    vi.useFakeTimers({ now: 1_000_000_000_000, toFake: ['Date'] });
    octokit = Object.assign(mockOctokit(), { paginate: vi.fn(), request: vi.fn() });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);
    scratch = ScratchRepo.fromEnvironment('unit');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('names a tag in the suite namespace', () => {
    expect(scratch.tag('demo-v1.0.0')).toBe('test/unit/1000000000-9-1/demo-v1.0.0');
  });

  it('deletes the releases on a reserved tag, then the tag, at teardown', async () => {
    const tag = scratch.tag('demo-v1.0.0');
    octokit.paginate.mockResolvedValue([
      { id: 1, tag_name: tag, draft: false, name: 'demo', body: '', assets: [{ name: 'b' }, { name: 'a' }] },
      { id: 2, tag_name: 'other', draft: false, name: 'x', body: '', assets: [] },
    ]);
    octokit.request.mockResolvedValue({});
    octokit.rest.git.deleteRef.mockResolvedValue({});

    expect(await scratch.releasesForTag(tag)).toEqual([
      { id: 1, draft: false, name: 'demo', body: '', assets: ['a', 'b'] },
    ]);
    await scratch.teardown();

    expect(octokit.request).toHaveBeenCalledWith('DELETE /repos/{owner}/{repo}/releases/{release_id}', {
      owner: 'owner',
      release_id: 1,
      repo: 'repo',
    });
    expect(octokit.rest.git.deleteRef).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', ref: `tags/${tag}` });
  });

  it('reads a tag once when no commit is expected', async () => {
    octokit.rest.git.getRef.mockRejectedValue(httpError(404, 'Not Found'));

    await expect(scratch.tagSha('demo')).resolves.toBeUndefined();
    expect(octokit.rest.git.getRef).toHaveBeenCalledTimes(1);
  });

  it('polls a tag until it reaches the expected commit', async () => {
    vi.useFakeTimers();
    try {
      octokit.rest.git.getRef
        .mockRejectedValueOnce(httpError(404, 'Not Found'))
        .mockResolvedValueOnce({ data: { object: { sha: 'old' } } })
        .mockResolvedValue({ data: { object: { sha: 'new' } } });

      const read = scratch.tagSha('demo', 'new');
      await vi.runAllTimersAsync();

      await expect(read).resolves.toBe('new');
      expect(octokit.rest.git.getRef).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns what it last saw once polling for a tag runs out', async () => {
    vi.useFakeTimers();
    try {
      octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'other' } } });

      const read = scratch.tagSha('demo', 'new');
      await vi.runAllTimersAsync();

      await expect(read).resolves.toBe('other');
      expect(octokit.rest.git.getRef).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits after creating a tag until a read sees it at its commit', async () => {
    vi.useFakeTimers();
    try {
      const createRef = vi.fn().mockResolvedValue({});
      Object.assign(octokit.rest.git, { createRef });
      octokit.rest.git.getRef
        .mockRejectedValueOnce(httpError(404, 'Not Found'))
        .mockResolvedValue({ data: { object: { sha: 'abc' } } });

      const created = scratch.createTag('demo', 'abc');
      await vi.runAllTimersAsync();

      await expect(created).resolves.toBeUndefined();
      expect(createRef).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', ref: 'refs/tags/demo', sha: 'abc' });
      expect(octokit.rest.git.getRef).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes a tag again while a read still sees it after an "already deleted" answer', async () => {
    vi.useFakeTimers();
    try {
      octokit.rest.git.deleteRef.mockRejectedValue(httpError(422, 'Reference does not exist'));
      octokit.rest.git.getRef
        .mockResolvedValueOnce({ data: { object: { sha: 'abc' } } })
        .mockRejectedValue(httpError(404, 'Not Found'));

      const deleted = scratch.deleteTag('demo');
      await vi.runAllTimersAsync();

      await expect(deleted).resolves.toBeUndefined();
      expect(octokit.rest.git.deleteRef).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a tag teardown left behind when a read keeps seeing it', async () => {
    vi.useFakeTimers();
    try {
      const tag = scratch.tag('lingering');
      octokit.paginate.mockResolvedValue([]);
      octokit.rest.git.deleteRef.mockRejectedValue(httpError(422, 'Reference does not exist'));
      octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'abc' } } });

      const teardown = scratch.teardown();
      const settled = expect(teardown).rejects.toThrow(`tag ${tag}: still present after teardown`);
      await vi.runAllTimersAsync();

      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a tag that was never created as deleted', async () => {
    scratch.tag('never-created');
    octokit.paginate.mockResolvedValue([]);
    octokit.rest.git.deleteRef.mockRejectedValue(httpError(422, 'Reference does not exist'));

    await expect(scratch.teardown()).resolves.toBeUndefined();
  });

  it('reports a tag teardown could not delete', async () => {
    const tag = scratch.tag('stuck');
    octokit.paginate.mockResolvedValue([]);
    octokit.rest.git.deleteRef.mockRejectedValue(httpError(403, 'Forbidden'));

    await expect(scratch.teardown()).rejects.toThrow(`tag ${tag}: Forbidden`);
  });
});
