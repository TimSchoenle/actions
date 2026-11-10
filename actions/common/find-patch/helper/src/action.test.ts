import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from 'actions-util/core';
import { describePatch, serializeMetadata } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { RunNotFoundError } from './find.js';
import { createArtifactApi } from './github-api.js';

import type { ArtifactApi, ArtifactSummary } from './find.js';

vi.mock('actions-util/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  debug: vi.fn(),
  info: vi.fn(),
  notice: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('./github-api.js', () => ({ createArtifactApi: vi.fn() }));

const BASE = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const PATCH = Buffer.from('diff --git a/x b/x\n');

let temp: string;

/** Every output the run set, by name. */
function outputs(): Record<string, unknown> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls);
}

/** The message the run failed with, or empty. */
function failure(): string {
  return String(vi.mocked(core.setFailed).mock.calls[0]?.[0] ?? '');
}

/** An artifact listing that answers with `artifacts`. */
function api(artifacts: ArtifactSummary[]): ArtifactApi & { listArtifacts: ReturnType<typeof vi.fn> } {
  return { listArtifacts: vi.fn().mockResolvedValue(artifacts) };
}

/** Sets action inputs the way the runner passes them. */
function inputs(values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'find-patch-action-'));
  inputs({
    artifact_name: 'docs-render',
    expected_head_sha: '',
    max_patch_bytes: '10485760',
    repository: 'owner/repo',
    run_id: '42',
    token: 'job-token',
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(temp, { force: true, recursive: true });
});

describe('lookup', () => {
  beforeEach(() => {
    inputs({ mode: 'lookup' });
  });

  it('reports a found artifact and creates an empty download directory under the runner temp', async () => {
    const listing = api([{ expired: false, id: 7, name: 'docs-render', sizeInBytes: 100 }]);

    await run({ runId: '1', temp }, { api: listing });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(listing.listArtifacts).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 42, 'docs-render');
    const result = outputs();
    expect(result).toEqual({
      directory: expect.stringContaining(path.join(temp, 'find-patch-docs-render-')),
      found: 'true',
      run_id: '42',
    });
    expect(await readdir(String(result['directory']))).toEqual([]);
  });

  it('takes the newest of several live artifacts of the name, with a warning naming them all', async () => {
    const listing = api([
      { expired: false, id: 7, name: 'docs-render', sizeInBytes: 100 },
      { expired: false, id: 9, name: 'docs-render', sizeInBytes: 100 },
    ]);

    await run({ runId: '1', temp }, { api: listing });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()['found']).toBe('true');
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('(9, 7)'));
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('fetches the newest, 9'));
  });

  it('fails before any download on an archive larger than any create-patch artifact can be', async () => {
    inputs({ max_patch_bytes: '1000' });
    const listing = api([{ expired: false, id: 7, name: 'docs-render', sizeInBytes: 1000 + 1024 * 1024 + 1 }]);

    await run({ runId: '1', temp }, { api: listing });

    expect(failure()).toContain('it was not downloaded');
    expect(outputs()).not.toHaveProperty('directory');
    expect(await readdir(temp)).toEqual([]);
  });

  it('does not warn for a single live artifact', async () => {
    await run({ runId: '1', temp }, { api: api([{ expired: false, id: 7, name: 'docs-render', sizeInBytes: 100 }]) });

    expect(core.warning).not.toHaveBeenCalled();
  });

  it('settles a missing artifact as missing, with nothing to commit and no directory', async () => {
    await run({ runId: '1', temp }, { api: api([]) });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()).toEqual({ found: 'false', has_changes: 'false', outcome: 'missing', run_id: '42' });
    expect(await readdir(temp)).toEqual([]);
  });

  it('looks in this run when run_id is empty', async () => {
    inputs({ run_id: '' });
    const listing = api([]);

    await run({ runId: '99', temp }, { api: listing });

    expect(listing.listArtifacts).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 99, 'docs-render');
    expect(outputs()['run_id']).toBe('99');
  });

  it('fails when run_id is empty outside a runner', async () => {
    inputs({ run_id: '' });

    await run({ runId: '', temp }, { api: api([]) });

    expect(failure()).toContain('run_id is empty and GITHUB_RUN_ID is not set');
  });

  it('builds the real API client from the token when none is injected', async () => {
    vi.mocked(createArtifactApi).mockReturnValue(api([]));

    await run({ runId: '1', temp });

    expect(createArtifactApi).toHaveBeenCalledWith('job-token');
    expect(outputs()['outcome']).toBe('missing');
  });

  it('fails when the token is empty and the real client is needed', async () => {
    inputs({ token: '' });

    await run({ runId: '1', temp });

    expect(failure()).toContain('token');
    expect(createArtifactApi).not.toHaveBeenCalled();
  });

  it('fails the step, not the outcome, when the run cannot be listed', async () => {
    const listing: ArtifactApi = {
      listArtifacts: vi.fn().mockRejectedValue(new RunNotFoundError({ owner: 'owner', repo: 'repo' }, 42)),
    };

    await run({ runId: '1', temp }, { api: listing });

    expect(failure()).toContain('Workflow run 42 of owner/repo was not found');
    expect(outputs()).toEqual({});
  });
});

describe('inspect', () => {
  let directory: string;

  /** Writes an artifact holding `patch`, made from `baseSha`, into the download directory. */
  async function lay(patch: Buffer, baseSha = BASE): Promise<void> {
    await writeFile(path.join(directory, 'changes.patch'), patch);
    await writeFile(path.join(directory, 'metadata.json'), serializeMetadata(describePatch(baseSha, patch)));
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(temp, 'download-'));
    inputs({ directory, mode: 'inspect', token: '' });
  });

  it('reports changes for a non-empty patch, without calling the API', async () => {
    await lay(PATCH);

    await run({ runId: '1', temp });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(createArtifactApi).not.toHaveBeenCalled();
    expect(outputs()).toEqual({ base_sha: BASE, directory, has_changes: 'true', outcome: 'changes' });
  });

  it('reports no_changes for an empty patch', async () => {
    await lay(Buffer.alloc(0));

    await run({ runId: '1', temp });

    expect(outputs()).toEqual({ base_sha: BASE, directory, has_changes: 'false', outcome: 'no_changes' });
  });

  it('reports branch_moved, with a notice, for a patch made from another commit than expected_head_sha', async () => {
    inputs({ expected_head_sha: BASE });
    await lay(PATCH, OTHER);

    await run({ runId: '1', temp });

    expect(outputs()).toEqual({ base_sha: OTHER, directory, has_changes: 'false', outcome: 'branch_moved' });
    expect(core.notice).toHaveBeenCalledWith(expect.stringContaining(`was made from ${OTHER}, not ${BASE}`));
  });

  it('reports changes for a patch made from expected_head_sha', async () => {
    inputs({ expected_head_sha: BASE });
    await lay(PATCH);

    await run({ runId: '1', temp });

    expect(outputs()).toEqual({ base_sha: BASE, directory, has_changes: 'true', outcome: 'changes' });
  });

  it('fails on a malformed artifact rather than reporting nothing to commit', async () => {
    await writeFile(path.join(directory, 'changes.patch'), PATCH);

    await run({ runId: '1', temp });

    expect(failure()).toContain('The patch artifact is invalid');
    expect(outputs()).toEqual({});
  });

  it('honours max_patch_bytes', async () => {
    inputs({ max_patch_bytes: '4' });
    await lay(PATCH);

    await run({ runId: '1', temp });

    expect(failure()).toContain('above max_patch_bytes (4)');
  });

  it('does not need run_id, which only lookup reads', async () => {
    inputs({ run_id: '' });
    await lay(PATCH);

    await run({ runId: '', temp });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()['outcome']).toBe('changes');
  });

  it('requires the directory', async () => {
    inputs({ directory: '' });

    await run({ runId: '1', temp });

    expect(failure()).toContain('directory');
  });
});

describe('input validation', () => {
  it.each([
    ['mode', { mode: 'commit' }, 'mode must be lookup or inspect; got "commit"'],
    ['artifact_name', { artifact_name: '../escape', mode: 'lookup' }, 'artifact_name must be'],
    ['run_id', { mode: 'lookup', run_id: '12a' }, 'run_id must be empty or a workflow run ID; got "12a"'],
    ['padded run_id', { mode: 'lookup', run_id: ' 42' }, 'run_id must be empty or a workflow run ID; got " 42"'],
    ['zero run_id', { mode: 'lookup', run_id: '0' }, 'run_id must be empty or a workflow run ID'],
    ['huge run_id', { mode: 'lookup', run_id: '99999999999999999999' }, 'larger than any workflow run ID'],
    ['expected_head_sha', { expected_head_sha: 'HEAD', mode: 'lookup' }, 'expected_head_sha must be empty or a full'],
    ['max_patch_bytes', { max_patch_bytes: '-1', mode: 'lookup' }, 'max_patch_bytes must be a positive whole number'],
    ['repository', { mode: 'lookup', repository: 'no-slash' }, "Invalid repository 'no-slash'"],
  ])('fails on an invalid %s before calling the API', async (_name, values, message) => {
    inputs(values);
    const listing = api([]);

    await run({ runId: '1', temp }, { api: listing });

    expect(failure()).toContain(message);
    expect(listing.listArtifacts).not.toHaveBeenCalled();
    expect(outputs()).toEqual({});
  });
});
