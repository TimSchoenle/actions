import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readEventContext, run } from './action.js';

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

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  allow_default_branch: 'false',
  branch: 'feature/x',
  dry_run: 'false',
  fail_on_error: 'true',
  repository: 'owner/repo',
  token: 'ghs_test_token',
};

const deleteBranchEvent: EventContext = { eventName: 'delete', refType: 'branch' };

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
  let summaryDirectory: string;

  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
    summaryDirectory = mkdtempSync(path.join(tmpdir(), 'wipe-cache-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(summaryDirectory, { force: true, recursive: true });
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

  it('writes the job summary when the runner provides one', async () => {
    const summaryFile = path.join(summaryDirectory, 'summary.md');
    writeFileSync(summaryFile, '');
    vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile);

    await run(fakeApi(), deleteBranchEvent);

    expect(readFileSync(summaryFile, 'utf8')).toContain('| 2 | 2 | 0 | 0 | 20 B |');
  });

  describe('delete events', () => {
    // The event fires for tags too, and its ref would otherwise be read as a branch of that name.
    it('skips a deleted tag without calling the API', async () => {
      const api = fakeApi();

      await run(api, { eventName: 'delete', refType: 'tag' });

      expect(api.getDefaultBranch).not.toHaveBeenCalled();
      expect(api.listCaches).not.toHaveBeenCalled();
      expect(core.notice).toHaveBeenCalledWith('Skipping: the delete event removed a tag, not a branch.');
      expect(outputs()).toEqual({ deleted_count: '0', failed_count: '0', matched_count: '0' });
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('skips a delete event whose ref type it cannot read', async () => {
      const api = fakeApi();

      await run(api, { eventName: 'delete', refType: undefined });

      expect(api.listCaches).not.toHaveBeenCalled();
      expect(core.notice).toHaveBeenCalledWith(expect.stringContaining('ref of unknown type'));
    });

    it('runs on any other event', async () => {
      const api = fakeApi();

      await run(api, { eventName: 'workflow_dispatch', refType: undefined });

      expect(api.deleteCache).toHaveBeenCalledTimes(2);
    });
  });

  describe('refusals', () => {
    it('fails on an empty branch, which a non-delete trigger leaves behind', async () => {
      setInputs({ branch: '' });
      const api = fakeApi();

      await run(api, { eventName: 'push', refType: undefined });

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
      refType: 'branch',
    });
  });

  it('does not read the payload of any other event', () => {
    expect(readEventContext({ GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: '/nonexistent' })).toEqual({
      eventName: 'push',
      refType: undefined,
    });
  });

  it('reports no ref type when the delete payload is absent or carries none', () => {
    expect(readEventContext({ GITHUB_EVENT_NAME: 'delete' })).toEqual({ eventName: 'delete', refType: undefined });
    expect(
      readEventContext({ GITHUB_EVENT_NAME: 'delete', GITHUB_EVENT_PATH: payload(JSON.stringify({ ref_type: 3 })) }),
    ).toEqual({ eventName: 'delete', refType: undefined });
  });

  it('fails on a payload it cannot parse', () => {
    const eventPath = payload('{not json');

    expect(() => readEventContext({ GITHUB_EVENT_NAME: 'delete', GITHUB_EVENT_PATH: eventPath })).toThrow(
      'Could not read the delete event payload',
    );
  });

  it('reads nothing outside a workflow', () => {
    expect(readEventContext({})).toEqual({ eventName: undefined, refType: undefined });
  });
});
