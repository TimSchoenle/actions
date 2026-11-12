import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from 'actions-util/core';
import { describePatch, serializeMetadata } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { PatchGit } from './git.js';
import type { CommitApi } from 'actions-util/commit-on-branch';

vi.mock('actions-util/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  debug: vi.fn(),
  info: vi.fn(),
  notice: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const BLOB = 'b'.repeat(40);

let root: string;
let temp: string;
let download: string;

function outputs(): Record<string, unknown> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls);
}

function fakeGit(): PatchGit {
  return {
    applyToScratchIndex: vi.fn(async () => [
      { dstMode: '100644', dstSha: BLOB, path: 'README.md', srcMode: '100644', srcSha: SHA, status: 'M' },
    ]),
    binaryPathsInPatch: vi.fn(async () => new Set<string>()),
    headSha: vi.fn(async () => SHA),
    linksInTree: vi.fn(async () => new Map<string, string>()),
    readBlob: vi.fn(async () => Buffer.from('# Title\n')),
  };
}

function fakeApi(): CommitApi {
  return {
    createCommit: vi.fn(async () => ({ oid: 'c'.repeat(40), url: 'https://github.com/o/r/commit/c' })),
    getHeadOid: vi.fn(async () => SHA),
  };
}

async function artifact(patch: string): Promise<void> {
  await writeFile(path.join(download, 'changes.patch'), patch);
  await writeFile(path.join(download, 'metadata.json'), serializeMetadata(describePatch(SHA, Buffer.from(patch))));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'commit-patch-action-'));
  temp = path.join(root, 'temp');
  download = path.join(root, 'download');
  await mkdir(temp);
  await mkdir(download);

  vi.stubEnv('INPUT_MODE', 'commit');
  vi.stubEnv('INPUT_ARTIFACT_NAME', 'update-readme');
  vi.stubEnv('INPUT_DIRECTORY', download);
  vi.stubEnv('INPUT_TOKEN', 'token');
  vi.stubEnv('INPUT_ALLOWED_PATHS', 'README.md SECURITY.md');
  vi.stubEnv('INPUT_ALLOW_WORKFLOW_CHANGES', 'false');
  vi.stubEnv('INPUT_ALLOW_BINARY', 'false');
  vi.stubEnv('INPUT_COMMIT_MESSAGE', 'docs: update');
  vi.stubEnv('INPUT_REPOSITORY', 'owner/repo');
  vi.stubEnv('INPUT_BRANCH', 'feature');
  vi.stubEnv('INPUT_EXPECTED_HEAD_SHA', SHA);
  vi.stubEnv('INPUT_EVENT_BRANCH', 'main');
  vi.stubEnv('INPUT_EVENT_HEAD_SHA', OTHER_SHA);
  vi.stubEnv('INPUT_MAX_PATCH_BYTES', '10485760');
  vi.stubEnv('INPUT_RUN_ID', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(root, { force: true, recursive: true });
});

describe('prepare', () => {
  beforeEach(() => {
    vi.stubEnv('INPUT_MODE', 'prepare');
    vi.stubEnv('INPUT_DIRECTORY', '');
    vi.stubEnv('INPUT_TOKEN', '');
  });

  // In a workflow_run job the event values name the default branch and its tip, not the pull request
  // the artifact came from. Falling back to them would commit an untrusted patch to the default branch.
  it.each([
    ['branch', 'INPUT_BRANCH'],
    ['expected_head_sha', 'INPUT_EXPECTED_HEAD_SHA'],
  ])('requires %s when run_id is set, instead of falling back to the event', async (input, variable) => {
    vi.stubEnv('INPUT_RUN_ID', '19284756301');
    vi.stubEnv(variable, '');

    await run({ temp, workspace: root });

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(`${input} must be set when run_id is set`));
    expect(await readdir(temp)).toEqual([]);
  });

  it('falls back to the event branch and head when run_id is empty', async () => {
    vi.stubEnv('INPUT_BRANCH', '');
    vi.stubEnv('INPUT_EXPECTED_HEAD_SHA', '');

    await run({ temp, workspace: root });

    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails when neither the input nor the event names a branch', async () => {
    vi.stubEnv('INPUT_BRANCH', '');
    vi.stubEnv('INPUT_EVENT_BRANCH', '');

    await run({ temp, workspace: root });

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('branch'));
  });

  it('validates an event branch like an explicit one', async () => {
    vi.stubEnv('INPUT_BRANCH', '');
    vi.stubEnv('INPUT_EVENT_BRANCH', 'refs/heads/main');

    await run({ temp, workspace: root });

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/branch must be a branch name/));
  });

  it('accepts a run ID from another run', async () => {
    vi.stubEnv('INPUT_RUN_ID', '19284756301');

    await run({ temp, workspace: root });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(await readdir(temp)).toHaveLength(1);
  });

  it('creates a fresh, empty directory under the runner temp directory', async () => {
    await run({ temp, workspace: root });

    expect(core.setFailed).not.toHaveBeenCalled();
    const directory = String(outputs()['directory']);
    expect(path.dirname(directory)).toBe(temp);
    expect(path.basename(directory)).toMatch(/^commit-patch-update-readme-/);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([
    ['an unsafe artifact name', 'INPUT_ARTIFACT_NAME', '../x', /artifact_name must be/],
    ['an abbreviated expected head', 'INPUT_EXPECTED_HEAD_SHA', 'abc1234', /expected_head_sha must be a full/],
    ['a malformed allowlist', 'INPUT_ALLOWED_PATHS', 'src/[ab].ts', /allowed_paths entry/],
    ['an empty allowlist', 'INPUT_ALLOWED_PATHS', '', /allowed_paths/],
    ['a malformed boolean', 'INPUT_ALLOW_WORKFLOW_CHANGES', 'yes', /allow_workflow_changes/],
    ['a malformed repository', 'INPUT_REPOSITORY', 'not-a-repo', /repository|owner\/repo/i],
    ['a malformed size limit', 'INPUT_MAX_PATCH_BYTES', '-1', /max_patch_bytes/],
    ['an empty commit message', 'INPUT_COMMIT_MESSAGE', '', /commit_message/],
    ['a run_id that is not a number', 'INPUT_RUN_ID', 'latest', /run_id must be empty or a workflow run ID/],
    ['a run_id of zero', 'INPUT_RUN_ID', '0', /run_id must be/],
    ['a whitespace-only run_id', 'INPUT_RUN_ID', ' ', /run_id must be/],
    ['a run_id with a trailing newline', 'INPUT_RUN_ID', '123\n', /run_id must be/],
    ['an expression that did not resolve to a number', 'INPUT_RUN_ID', '${{ github.run_id }}', /run_id must be/],
    ['a full ref name as the branch', 'INPUT_BRANCH', 'refs/heads/main', /branch must be a branch name/],
    ['a branch git would refuse', 'INPUT_BRANCH', 'a..b', /branch must be a branch name/],
  ])('fails on %s before anything is downloaded', async (_name, variable, value, message) => {
    vi.stubEnv(variable, value);

    await run({ temp, workspace: root });

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(message));
    expect(await readdir(temp)).toEqual([]);
  });
});

describe('commit', () => {
  it('commits and publishes the outputs', async () => {
    const api = fakeApi();
    await artifact('diff --git a/README.md b/README.md\n');

    await run({ temp, workspace: root }, { api, git: fakeGit() });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()).toEqual({
      changes_committed: 'true',
      commit_sha: 'c'.repeat(40),
      commit_url: 'https://github.com/o/r/commit/c',
      outcome: 'committed',
    });
    expect(api.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({ expectedHeadOid: SHA, message: 'docs: update' }),
    );
  });

  it('publishes no_changes for an empty patch', async () => {
    await artifact('');

    await run({ temp, workspace: root }, { api: fakeApi(), git: fakeGit() });

    expect(outputs()).toEqual({ changes_committed: 'false', commit_sha: '', commit_url: '', outcome: 'no_changes' });
  });

  it('publishes branch_moved and a notice when the branch moved', async () => {
    const api = fakeApi();
    vi.mocked(api.getHeadOid).mockResolvedValue('e'.repeat(40));
    await artifact('diff --git a/README.md b/README.md\n');

    await run({ temp, workspace: root }, { api, git: fakeGit() });

    expect(outputs()).toMatchObject({ changes_committed: 'false', outcome: 'branch_moved' });
    expect(core.notice).toHaveBeenCalledOnce();
  });

  it('fails the step when the policy refuses the patch', async () => {
    vi.stubEnv('INPUT_ALLOWED_PATHS', 'SECURITY.md');
    const api = fakeApi();
    await artifact('diff --git a/README.md b/README.md\n');

    await run({ temp, workspace: root }, { api, git: fakeGit() });

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('"README.md": the path matches no allowed_paths pattern'),
    );
    expect(api.createCommit).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('requires the token', async () => {
    vi.stubEnv('INPUT_TOKEN', '');

    await run({ temp, workspace: root }, { api: fakeApi(), git: fakeGit() });

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('token'));
  });

  it('validates run_id in commit mode too', async () => {
    const api = fakeApi();
    vi.stubEnv('INPUT_RUN_ID', 'latest');
    await artifact('diff --git a/README.md b/README.md\n');

    await run({ temp, workspace: root }, { api, git: fakeGit() });

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/run_id must be/));
    expect(api.createCommit).not.toHaveBeenCalled();
  });

  it('refuses an unknown mode', async () => {
    vi.stubEnv('INPUT_MODE', 'apply');

    await run({ temp, workspace: root });

    expect(core.setFailed).toHaveBeenCalledWith('mode must be prepare or commit; got "apply".');
  });
});
