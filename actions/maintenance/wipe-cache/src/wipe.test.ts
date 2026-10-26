import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_ROUNDS, wipeBranchCaches } from './wipe.js';

import type { CacheApi, CacheEntry, DeleteOutcome } from './github-api.js';
import type { WipeOptions } from './wipe.js';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  warning: vi.fn(),
}));

const REF = 'refs/heads/feature/x';

function entry(id: number, ref = REF): CacheEntry {
  return { id, key: `key-${id}`, ref, sizeInBytes: id * 100 };
}

const baseOptions: WipeOptions = {
  allowDefaultBranch: false,
  dryRun: false,
  repository: { owner: 'owner', repo: 'repo' },
  target: { name: 'feature/x', ref: REF },
};

/**
 * An in-memory cache store: listing returns what is left, deleting removes it.
 *
 * `failing` ids reject every delete; `stuckRounds` keeps an id failing for that many attempts only.
 */
function fakeStore(
  initial: CacheEntry[],
  { defaultBranch = 'main', failing = new Set<number>() }: { defaultBranch?: string; failing?: Set<number> } = {},
): CacheApi & { store: Map<number, CacheEntry> } {
  const store = new Map(initial.map((cache) => [cache.id, cache]));

  return {
    deleteCache: vi.fn(async (_repository, id: number): Promise<DeleteOutcome> => {
      if (failing.has(id)) {
        throw new Error(`Cannot delete ${id}`);
      }

      return store.delete(id) ? 'deleted' : 'not-found';
    }),
    getDefaultBranch: vi.fn(async () => defaultBranch),
    listCaches: vi.fn(async () => [...store.values()]),
    store,
  };
}

describe('wipeBranchCaches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes every listed entry and stops on an empty listing', async () => {
    const api = fakeStore([entry(1), entry(2), entry(3)]);

    const result = await wipeBranchCaches(api, baseOptions);

    expect(result.deleted.map((cache) => cache.id)).toEqual([1, 2, 3]);
    expect(result.matched).toHaveLength(3);
    expect(result.failures).toEqual([]);
    expect(result.stopReason).toBe('empty');
    expect(result.rounds).toBe(2);
    expect(api.store.size).toBe(0);
    expect(api.listCaches).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, REF);
  });

  it('reports an empty branch after a single listing', async () => {
    const api = fakeStore([]);

    const result = await wipeBranchCaches(api, baseOptions);

    expect(result).toMatchObject({ deleted: [], matched: [], rounds: 1, stopReason: 'empty' });
    expect(api.deleteCache).not.toHaveBeenCalled();
  });

  describe('default branch', () => {
    it('refuses to wipe the default branch, before listing anything', async () => {
      const api = fakeStore([entry(1)], { defaultBranch: 'feature/x' });

      await expect(wipeBranchCaches(api, baseOptions)).rejects.toThrow(
        'Refusing to wipe the caches of "feature/x", the default branch of owner/repo. Set allow_default_branch: true',
      );
      expect(api.listCaches).not.toHaveBeenCalled();
      expect(api.deleteCache).not.toHaveBeenCalled();
    });

    it('wipes the default branch when explicitly allowed, without looking it up', async () => {
      const api = fakeStore([entry(1)], { defaultBranch: 'feature/x' });

      const result = await wipeBranchCaches(api, { ...baseOptions, allowDefaultBranch: true });

      expect(result.deleted).toHaveLength(1);
      expect(api.getDefaultBranch).not.toHaveBeenCalled();
    });

    // Git branch names are case-sensitive, so `Main` is a different branch from `main`.
    it('compares branch names exactly', async () => {
      const api = fakeStore([entry(1)], { defaultBranch: 'Feature/X' });

      await expect(wipeBranchCaches(api, baseOptions)).resolves.toMatchObject({ stopReason: 'empty' });
    });

    it('propagates a failing default-branch lookup instead of assuming it is safe', async () => {
      const api = fakeStore([entry(1)]);
      vi.mocked(api.getDefaultBranch).mockRejectedValue(new Error('Bad credentials'));

      await expect(wipeBranchCaches(api, baseOptions)).rejects.toThrow('Bad credentials');
      expect(api.deleteCache).not.toHaveBeenCalled();
    });
  });

  it('lists without deleting on a dry run', async () => {
    const api = fakeStore([entry(1), entry(2)]);

    const result = await wipeBranchCaches(api, { ...baseOptions, dryRun: true });

    expect(result).toMatchObject({ deleted: [], rounds: 1, stopReason: 'dry-run' });
    expect(result.matched.map((cache) => cache.id)).toEqual([1, 2]);
    expect(api.deleteCache).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith('  Would delete "key-1" (id 1).');
  });

  it('still refuses the default branch on a dry run', async () => {
    const api = fakeStore([entry(1)], { defaultBranch: 'feature/x' });

    await expect(wipeBranchCaches(api, { ...baseOptions, dryRun: true })).rejects.toThrow('Refusing');
  });

  // The defence against an API that ignored the `ref` filter and returned the whole repository.
  it('never deletes an entry recorded against another ref', async () => {
    const api = fakeStore([entry(1), entry(2, 'refs/heads/main'), entry(3, 'refs/pull/4/merge')]);

    const result = await wipeBranchCaches(api, baseOptions);

    expect(api.deleteCache).toHaveBeenCalledTimes(1);
    expect(api.deleteCache).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 1);
    expect(result.matched.map((cache) => cache.id)).toEqual([1]);
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Ignored 2 cache entr(ies)'));
  });

  describe('partial failure', () => {
    it('keeps deleting past a failure and reports the entry that survived', async () => {
      const api = fakeStore([entry(1), entry(2), entry(3)], { failing: new Set([2]) });

      const result = await wipeBranchCaches(api, baseOptions);

      expect(result.deleted.map((cache) => cache.id)).toEqual([1, 3]);
      expect(result.failures).toEqual([{ entry: entry(2), message: 'Cannot delete 2' }]);
      // Round 1 deletes 1 and 3; round 2 retries 2 alone, removes nothing and stops.
      expect(result).toMatchObject({ rounds: 2, stopReason: 'no-progress' });
      expect(core.warning).toHaveBeenCalledWith('Failed to delete cache "key-2" (id 2): Cannot delete 2');
    });

    it('stops after one round when nothing can be deleted', async () => {
      const api = fakeStore([entry(1), entry(2)], { failing: new Set([1, 2]) });

      const result = await wipeBranchCaches(api, baseOptions);

      expect(result).toMatchObject({ deleted: [], rounds: 1, stopReason: 'no-progress' });
      expect(result.failures).toHaveLength(2);
      expect(api.listCaches).toHaveBeenCalledTimes(1);
    });

    it('clears a failure once a retry succeeds', async () => {
      const api = fakeStore([entry(1), entry(2)]);
      vi.mocked(api.deleteCache).mockRejectedValueOnce(new Error('transient'));

      const result = await wipeBranchCaches(api, baseOptions);

      expect(result.failures).toEqual([]);
      expect(result.deleted.map((cache) => cache.id)).toEqual([2, 1]);
      expect(result.stopReason).toBe('empty');
    });

    it('clears a failure once the entry is no longer listed', async () => {
      const api = fakeStore([entry(1), entry(2)], { failing: new Set([1]) });
      vi.mocked(api.deleteCache).mockImplementationOnce(async () => {
        // Something else removes entry 1 while this run fails to.
        api.store.delete(1);
        throw new Error('conflict');
      });

      const result = await wipeBranchCaches(api, baseOptions);

      expect(result.failures).toEqual([]);
      expect(result.stopReason).toBe('empty');
    });

    it('counts a 404 on delete as already gone, not as deleted or failed', async () => {
      const api = fakeStore([entry(1), entry(2)]);
      vi.mocked(api.deleteCache).mockResolvedValueOnce('not-found');

      const result = await wipeBranchCaches(api, baseOptions);

      expect(result.alreadyGone.map((cache) => cache.id)).toEqual([1]);
      expect(result.deleted.map((cache) => cache.id)).toContain(2);
      expect(result.failures).toEqual([]);
    });

    // A listing that lags behind the deletes would otherwise keep returning the same entry.
    it('stops when a round only finds entries that are already gone', async () => {
      const stale = [entry(1)];
      const api = fakeStore(stale);
      vi.mocked(api.listCaches).mockResolvedValue(stale);
      vi.mocked(api.deleteCache).mockResolvedValue('not-found');

      const result = await wipeBranchCaches(api, baseOptions);

      expect(result).toMatchObject({ deleted: [], failures: [], rounds: 1, stopReason: 'empty' });
      expect(result.alreadyGone).toEqual([entry(1)]);
    });
  });

  it('wipes entries saved while it runs, up to the round limit', async () => {
    let next = 1;
    const api = fakeStore([]);
    vi.mocked(api.listCaches).mockImplementation(async () => {
      // A job still running on the branch saves a fresh entry before every listing.
      api.store.set(next, entry(next));
      next += 1;

      return [...api.store.values()];
    });

    const result = await wipeBranchCaches(api, baseOptions);

    expect(result).toMatchObject({ rounds: MAX_ROUNDS, stopReason: 'round-limit' });
    expect(result.deleted).toHaveLength(MAX_ROUNDS);
    expect(api.listCaches).toHaveBeenCalledTimes(MAX_ROUNDS);
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining(`after ${MAX_ROUNDS} rounds`));
  });

  it('counts an entry listed in several rounds once', async () => {
    const api = fakeStore([entry(1), entry(2)], { failing: new Set([2]) });

    const result = await wipeBranchCaches(api, baseOptions);

    expect(result.matched.map((cache) => cache.id)).toEqual([1, 2]);
  });

  it('propagates a failing listing', async () => {
    const api = fakeStore([entry(1)]);
    vi.mocked(api.listCaches).mockRejectedValue(new Error('Resource not accessible by integration'));

    await expect(wipeBranchCaches(api, baseOptions)).rejects.toThrow('Resource not accessible by integration');
  });
});
