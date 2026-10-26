import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readEventContext, run } from './action.js';
import { createCacheApi } from './github-api.js';

import type { EventContext } from './action.js';
import type { CacheApi, CacheEntry } from './github-api.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so the tests
 * exercise the actual `getInput` semantics, including `required` and boolean parsing.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  notice: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

// Only the factory is replaced, so a case can run without an injected API and still reach no network.
vi.mock('./github-api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./github-api.js')>()),
  createCacheApi: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  allow_default_branch: 'false',
  branch: 'feature/x',
  dry_run: 'false',
  fail_on_error: 'true',
  repository: 'owner/repo',
  token: 'ghs_test_token',
};

const deleteBranchEvent: EventContext = { eventName: 'delete', ref: 'feature/x', refType: 'branch' };

function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function entry(id: number, ref = 'refs/heads/feature/x'): CacheEntry {
  return { id, key: `key-${id}`, ref, sizeInBytes: 10 };
}

function fakeApi(entries: CacheEntry[] = [entry(1), entry(2)], failing = new Set<number>()): CacheApi {
  const store = new Map(entries.map((cache) => [cache.id, cache]));

  return {
    deleteCache: vi.fn(async (_repository, id: number) => {
      if (failing.has(id)) {
        throw new Error(`Cannot delete ${id}`);
      }
      store.delete(id);

      return 'deleted' as const;
    }),
    getDefaultBranch: vi.fn(async () => 'main'),
    listCaches: vi.fn(async () => [...store.values()]),
  };
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls.map(([name, value]) => [name, String(value)]));
}

describe('wipe-cache action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
    // Keeps every case off the runner's own job summary unless it opts in.
    vi.stubEnv('GITHUB_STEP_SUMMARY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    core.summary.emptyBuffer();
  });

  it('wipes the branch and publishes the counts', async () => {
    const api = fakeApi();

    await run(api, deleteBranchEvent);

    expect(api.listCaches).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 'refs/heads/feature/x');
    expect(outputs()).toEqual({ deleted_count: '2', failed_count: '0', matched_count: '2' });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('accepts a fully qualified ref', async () => {
    setInputs({ branch: 'refs/heads/feature/x' });
    const api = fakeApi();

    await run(api, deleteBranchEvent);

    expect(api.listCaches).toHaveBeenCalledWith(expect.anything(), 'refs/heads/feature/x');
  });

  // `core.summary` is a module singleton that caches the first GITHUB_STEP_SUMMARY it reads, and on a
  // runner that variable is already set for the whole test process. The write is therefore stubbed
  // and the rendered markdown read from the call, rather than from whichever file the cache points at.
  it('writes the job summary when the runner provides one', async () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', '/runner/step-summary.md');
    const addRaw = vi.spyOn(core.summary, 'addRaw');
    const write = vi.spyOn(core.summary, 'write').mockResolvedValue(core.summary);

    await run(fakeApi(), deleteBranchEvent);

    expect(write).toHaveBeenCalledTimes(1);
    expect(addRaw).toHaveBeenCalledWith(expect.stringContaining('| 2 | 2 | 0 | 0 | 20 B |'));
  });

  it('writes no job summary outside a runner', async () => {
    const write = vi.spyOn(core.summary, 'write');

    await run(fakeApi(), deleteBranchEvent);

    expect(write).not.toHaveBeenCalled();
  });

  it('writes no job summary when the runner variable is unset', async () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', undefined);
    const write = vi.spyOn(core.summary, 'write');

    await run(fakeApi(), deleteBranchEvent);

    expect(write).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  // Covers the production wiring: the event is read from the runner and the API built from the token.
  it('reads the runner event and builds the API from the token when none is injected', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'wipe-cache-run-'));

    try {
      const eventPath = path.join(directory, 'event.json');
      writeFileSync(eventPath, JSON.stringify({ ref: 'feature/gone', ref_type: 'branch' }));
      vi.stubEnv('GITHUB_EVENT_NAME', 'delete');
      vi.stubEnv('GITHUB_EVENT_PATH', eventPath);
      setInputs({ branch: '' });
      const api = fakeApi([entry(1, 'refs/heads/feature/gone')]);
      vi.mocked(createCacheApi).mockReturnValue(api);

      await run();

      expect(createCacheApi).toHaveBeenCalledWith('ghs_test_token');
      expect(api.listCaches).toHaveBeenCalledWith(expect.anything(), 'refs/heads/feature/gone');
      expect(outputs()).toEqual({ deleted_count: '1', failed_count: '0', matched_count: '1' });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  describe('delete events', () => {
    it('takes the deleted branch from the event when branch is empty', async () => {
      setInputs({ branch: '' });
      const api = fakeApi();

      await run(api, deleteBranchEvent);

      expect(api.listCaches).toHaveBeenCalledWith(expect.anything(), 'refs/heads/feature/x');
      expect(api.deleteCache).toHaveBeenCalledTimes(2);
    });

    it('prefers an explicit branch over the deleted one', async () => {
      setInputs({ branch: 'other' });
      const api = fakeApi([]);

      await run(api, deleteBranchEvent);

      expect(api.listCaches).toHaveBeenCalledWith(expect.anything(), 'refs/heads/other');
    });

    it('fails on a branch delete event whose payload names no ref', async () => {
      setInputs({ branch: '' });
      const api = fakeApi();

      await run(api, { eventName: 'delete', ref: undefined, refType: 'branch' });

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('No branch to wipe'));
      expect(api.listCaches).not.toHaveBeenCalled();
    });

    // The event fires for tags too, and its ref would otherwise be read as a branch of that name.
    it('skips a deleted tag without calling the API', async () => {
      const api = fakeApi();

      await run(api, { eventName: 'delete', ref: 'v1.0.0', refType: 'tag' });

      expect(api.getDefaultBranch).not.toHaveBeenCalled();
      expect(api.listCaches).not.toHaveBeenCalled();
      expect(core.notice).toHaveBeenCalledWith('Skipping: the delete event removed a tag, not a branch.');
      expect(outputs()).toEqual({ deleted_count: '0', failed_count: '0', matched_count: '0' });
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('skips a delete event whose ref type it cannot read', async () => {
      const api = fakeApi();

      await run(api, { eventName: 'delete', ref: undefined, refType: undefined });

      expect(api.listCaches).not.toHaveBeenCalled();
      expect(core.notice).toHaveBeenCalledWith(expect.stringContaining('ref of unknown type'));
    });

    it('runs on any other event', async () => {
      const api = fakeApi();

      await run(api, { eventName: 'workflow_dispatch', ref: undefined, refType: undefined });

      expect(api.deleteCache).toHaveBeenCalledTimes(2);
    });
  });

  describe('refusals', () => {
    // A push payload carries a ref too, the branch that was pushed; taking it would wipe a live branch.
    it('fails on an empty branch outside a delete event, rather than taking the event ref', async () => {
      setInputs({ branch: '' });
      const api = fakeApi();

      await run(api, { eventName: 'push', ref: undefined, refType: undefined });

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('No branch to wipe'));
      expect(api.listCaches).not.toHaveBeenCalled();
      expect(core.setOutput).not.toHaveBeenCalled();
    });

    it('fails on the default branch and deletes nothing', async () => {
      setInputs({ branch: 'refs/heads/main' });
      const api = fakeApi();

      await run(api, deleteBranchEvent);

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Refusing to wipe the caches of "main"'));
      expect(api.deleteCache).not.toHaveBeenCalled();
    });

    it('wipes the default branch when allow_default_branch is true', async () => {
      setInputs({ allow_default_branch: 'true', branch: 'main' });
      const api = fakeApi([entry(1, 'refs/heads/main'), entry(2, 'refs/heads/main')]);

      await run(api, deleteBranchEvent);

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(api.deleteCache).toHaveBeenCalledTimes(2);
    });

    it('fails on a malformed repository', async () => {
      setInputs({ repository: 'owner' });

      await run(fakeApi(), deleteBranchEvent);

      expect(core.setFailed).toHaveBeenCalledWith("Invalid repository 'owner'. Expected the format 'owner/repo'.");
    });

    it.each(['token', 'repository'])('fails when the required input %s is missing', async (name) => {
      setInputs({ [name]: '' });

      await run(fakeApi(), deleteBranchEvent);

      expect(core.setFailed).toHaveBeenCalledWith(`Input required and not supplied: ${name}`);
    });

    it('fails on a boolean input that is not true or false', async () => {
      setInputs({ dry_run: 'yes please' });

      await run(fakeApi(), deleteBranchEvent);

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('dry_run'));
    });
  });

  it('deletes nothing on a dry run', async () => {
    setInputs({ dry_run: 'true' });
    const api = fakeApi();

    await run(api, deleteBranchEvent);

    expect(api.deleteCache).not.toHaveBeenCalled();
    expect(outputs()).toEqual({ deleted_count: '0', failed_count: '0', matched_count: '2' });
  });

  describe('failed deletions', () => {
    it('fails the step after publishing the counts', async () => {
      await run(fakeApi([entry(1), entry(2)], new Set([2])), deleteBranchEvent);

      expect(outputs()).toEqual({ deleted_count: '1', failed_count: '1', matched_count: '2' });
      expect(core.setFailed).toHaveBeenCalledWith('1 cache entr(ies) could not be deleted.');
    });

    it('only warns when fail_on_error is false', async () => {
      setInputs({ fail_on_error: 'false' });

      await run(fakeApi([entry(1), entry(2)], new Set([2])), deleteBranchEvent);

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledWith(
        '1 cache entr(ies) could not be deleted; continuing because fail_on_error is false.',
      );
      expect(outputs()['failed_count']).toBe('1');
    });
  });

  it('fails when the listing is refused', async () => {
    const api = fakeApi();
    vi.mocked(api.listCaches).mockRejectedValue(new Error('Resource not accessible by integration'));

    await run(api, deleteBranchEvent);

    expect(core.setFailed).toHaveBeenCalledWith('Resource not accessible by integration');
  });
});

describe('readEventContext', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'wipe-cache-event-'));
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  function payload(contents: string): string {
    const file = path.join(directory, 'event.json');
    writeFileSync(file, contents);

    return file;
  }

  it('reads the ref type of a delete event', () => {
    const eventPath = payload(JSON.stringify({ ref: 'feature/x', ref_type: 'branch' }));

    expect(readEventContext({ GITHUB_EVENT_NAME: 'delete', GITHUB_EVENT_PATH: eventPath })).toEqual({
      eventName: 'delete',
      ref: 'feature/x',
      refType: 'branch',
    });
  });

  it('does not read the payload of any other event', () => {
    expect(readEventContext({ GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: '/nonexistent' })).toEqual({
      eventName: 'push',
      ref: undefined,
      refType: undefined,
    });
  });

  it('reports no ref type when the delete payload is absent or carries none', () => {
    expect(readEventContext({ GITHUB_EVENT_NAME: 'delete' })).toEqual({
      eventName: 'delete',
      ref: undefined,
      refType: undefined,
    });
    expect(
      readEventContext({ GITHUB_EVENT_NAME: 'delete', GITHUB_EVENT_PATH: payload(JSON.stringify({ ref_type: 3 })) }),
    ).toEqual({ eventName: 'delete', ref: undefined, refType: undefined });
  });

  it('fails on a payload it cannot parse', () => {
    const eventPath = payload('{not json');

    expect(() => readEventContext({ GITHUB_EVENT_NAME: 'delete', GITHUB_EVENT_PATH: eventPath })).toThrow(
      'Could not read the delete event payload',
    );
  });

  // JSON.parse accepts any JSON value; only an object can carry `ref` and `ref_type`.
  it.each(['null', '[]', '"branch"', '3', 'true'])('fails on a payload that is not a JSON object: %s', (contents) => {
    const eventPath = payload(contents);

    expect(() => readEventContext({ GITHUB_EVENT_NAME: 'delete', GITHUB_EVENT_PATH: eventPath })).toThrow(
      /Could not read the delete event payload at .*: the payload is not a JSON object/,
    );
  });

  it('reads nothing outside a workflow', () => {
    expect(readEventContext({})).toEqual({ eventName: undefined, ref: undefined, refType: undefined });
  });
});
