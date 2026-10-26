import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCacheApi } from './github-api.js';

vi.mock('@actions/github');

interface OctokitMock {
  paginate: { iterator: ReturnType<typeof vi.fn> };
  rest: {
    actions: {
      deleteActionsCacheById: ReturnType<typeof vi.fn>;
      getActionsCacheList: ReturnType<typeof vi.fn>;
    };
    repos: { get: ReturnType<typeof vi.fn> };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    paginate: { iterator: vi.fn() },
    rest: {
      actions: { deleteActionsCacheById: vi.fn(), getActionsCacheList: vi.fn() },
      repos: { get: vi.fn() },
    },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

/** Yields each page the way `paginate.iterator` does: a response whose `data` is that page's entries. */
async function* pages(...pageData: unknown[][]): AsyncGenerator<{ data: unknown[] }> {
  for (const data of pageData) {
    yield { data };
  }
}

function apiCache(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, key: `key-${id}`, ref: 'refs/heads/feature/x', size_in_bytes: 1024, ...overrides };
}

const repository = { owner: 'owner', repo: 'repo' };

describe('createCacheApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  describe('listCaches', () => {
    it('requests the largest page size, filtered by ref', async () => {
      octokit.paginate.iterator.mockReturnValue(pages([]));

      await createCacheApi('token').listCaches(repository, 'refs/heads/feature/x');

      expect(octokit.paginate.iterator).toHaveBeenCalledWith(octokit.rest.actions.getActionsCacheList, {
        owner: 'owner',
        per_page: 100,
        ref: 'refs/heads/feature/x',
        repo: 'repo',
      });
    });

    it('collects the entries of every page', async () => {
      const first = Array.from({ length: 100 }, (_, index) => apiCache(index + 1));
      octokit.paginate.iterator.mockReturnValue(pages(first, [apiCache(101), apiCache(102)]));

      const entries = await createCacheApi('token').listCaches(repository, 'refs/heads/feature/x');

      expect(entries).toHaveLength(102);
      expect(entries.at(-1)).toEqual({ id: 102, key: 'key-102', ref: 'refs/heads/feature/x', sizeInBytes: 1024 });
    });

    it('drops entries without an id or a ref, and defaults a missing key and size', async () => {
      octokit.paginate.iterator.mockReturnValue(
        pages([
          apiCache(1, { id: undefined }),
          apiCache(2, { ref: undefined }),
          apiCache(3, { key: undefined, size_in_bytes: undefined }),
        ]),
      );

      const entries = await createCacheApi('token').listCaches(repository, 'refs/heads/feature/x');

      expect(entries).toEqual([{ id: 3, key: '', ref: 'refs/heads/feature/x', sizeInBytes: 0 }]);
    });

    it('propagates a failing page', async () => {
      octokit.paginate.iterator.mockReturnValue(
        (async function* failing() {
          yield { data: [apiCache(1)] };
          throw new Error('Server Error');
        })(),
      );

      await expect(createCacheApi('token').listCaches(repository, 'refs/heads/x')).rejects.toThrow('Server Error');
    });
  });

  describe('deleteCache', () => {
    it('deletes by id', async () => {
      octokit.rest.actions.deleteActionsCacheById.mockResolvedValue({ status: 204 });

      await expect(createCacheApi('token').deleteCache(repository, 7)).resolves.toBe('deleted');
      expect(octokit.rest.actions.deleteActionsCacheById).toHaveBeenCalledWith({
        cache_id: 7,
        owner: 'owner',
        repo: 'repo',
      });
    });

    it('reports an entry that is already gone', async () => {
      octokit.rest.actions.deleteActionsCacheById.mockRejectedValue(
        Object.assign(new Error('Not Found'), { status: 404 }),
      );

      await expect(createCacheApi('token').deleteCache(repository, 7)).resolves.toBe('not-found');
    });

    it('propagates every other failure', async () => {
      octokit.rest.actions.deleteActionsCacheById.mockRejectedValue(
        Object.assign(new Error('Resource not accessible by integration'), { status: 403 }),
      );

      await expect(createCacheApi('token').deleteCache(repository, 7)).rejects.toThrow('Resource not accessible');
    });
  });

  describe('getDefaultBranch', () => {
    it('reads the default branch of the repository', async () => {
      octokit.rest.repos.get.mockResolvedValue({ data: { default_branch: 'trunk' } });

      await expect(createCacheApi('token').getDefaultBranch(repository)).resolves.toBe('trunk');
      expect(octokit.rest.repos.get).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });
    });
  });
});
