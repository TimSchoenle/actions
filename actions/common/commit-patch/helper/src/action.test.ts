import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { describePatch, serializeMetadata } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { PatchGit } from './git.js';
import type { CommitApi } from 'actions-util/commit-on-branch';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  debug: vi.fn(),
  info: vi.fn(),
  notice: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

const SHA = 'a'.repeat(40);
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
  vi.stubEnv('INPUT_MAX_PATCH_BYTES', '10485760');
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

  it('refuses an unknown mode', async () => {
    vi.stubEnv('INPUT_MODE', 'apply');

    await run({ temp, workspace: root });

    expect(core.setFailed).toHaveBeenCalledWith('mode must be prepare or commit; got "apply".');
  });
});
