import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { createCommitApi } from 'actions-util/commit-on-branch';
import { describePatch, runGit, runGitText, serializeMetadata } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { CommitApi } from 'actions-util/commit-on-branch';

// The tests in action.test.ts inject every collaborator. These run the helper the way the bundle
// does: no arguments, the runner context read from the environment, and the real git client applying
// a real patch. Only the GitHub API is replaced, at the module boundary.
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  debug: vi.fn(),
  info: vi.fn(),
  notice: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

vi.mock('actions-util/commit-on-branch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('actions-util/commit-on-branch')>()),
  createCommitApi: vi.fn(),
}));

let root: string;
let repo: string;
let temp: string;
let download: string;
let base: string;
let api: CommitApi;

function git(...args: string[]): Promise<string> {
  return runGitText(args, { cwd: repo });
}

/** Writes an artifact holding the diff of `README.md` against `against`, then restores the checkout. */
async function artifactFromEdit(against: string): Promise<void> {
  await writeFile(path.join(repo, 'README.md'), '# Title\n\nMore.\n');
  const patch = await runGit(['diff', '--binary', '--full-index', 'HEAD'], { cwd: repo });
  await git('checkout', '--quiet', '--', 'README.md');

  await writeFile(path.join(download, 'changes.patch'), patch);
  await writeFile(path.join(download, 'metadata.json'), serializeMetadata(describePatch(against, patch)));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'commit-patch-defaults-'));
  repo = path.join(root, 'repo');
  temp = path.join(root, 'temp');
  download = path.join(root, 'download');
  await Promise.all([mkdir(repo), mkdir(temp), mkdir(download)]);

  await runGit(['init', '--quiet', '--initial-branch=main'], { cwd: repo });
  await writeFile(path.join(repo, 'README.md'), '# Title\n');
  await git('add', 'README.md');
  await git(
    '-c',
    'user.email=t@example.com',
    '-c',
    'user.name=T',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'seed',
  );
  base = await git('rev-parse', 'HEAD');

  api = {
    createCommit: vi.fn(async () => ({ oid: 'c'.repeat(40), url: 'https://github.com/o/r/commit/c' })),
    getHeadOid: vi.fn(async () => base),
  };
  vi.mocked(createCommitApi).mockReturnValue(api);

  vi.stubEnv('GITHUB_WORKSPACE', repo);
  vi.stubEnv('RUNNER_TEMP', temp);
  vi.stubEnv('INPUT_MODE', 'commit');
  vi.stubEnv('INPUT_ARTIFACT_NAME', 'update-readme');
  vi.stubEnv('INPUT_DIRECTORY', download);
  vi.stubEnv('INPUT_TOKEN', 'token');
  vi.stubEnv('INPUT_ALLOWED_PATHS', 'README.md');
  vi.stubEnv('INPUT_ALLOW_WORKFLOW_CHANGES', 'false');
  vi.stubEnv('INPUT_ALLOW_BINARY', 'false');
  vi.stubEnv('INPUT_COMMIT_MESSAGE', 'docs: update');
  vi.stubEnv('INPUT_REPOSITORY', 'owner/repo');
  vi.stubEnv('INPUT_BRANCH', 'feature');
  vi.stubEnv('INPUT_EXPECTED_HEAD_SHA', base);
  vi.stubEnv('INPUT_MAX_PATCH_BYTES', '10485760');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(root, { force: true, recursive: true });
});

describe('run with the default collaborators', () => {
  it('applies the patch with git in GITHUB_WORKSPACE and commits through the token-bound API', async () => {
    await artifactFromEdit(base);

    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(createCommitApi).toHaveBeenCalledWith('token');
    expect(api.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedHeadOid: base,
        fileChanges: {
          additions: [{ contents: Buffer.from('# Title\n\nMore.\n').toString('base64'), path: 'README.md' }],
          deletions: [],
        },
      }),
    );
    expect(core.info).toHaveBeenCalledWith('Committing 1 addition(s) and 0 deletion(s).');
    expect(await git('status', '--porcelain')).toBe('');
  });

  it('reports a patch made against another head through core.notice', async () => {
    await artifactFromEdit('d'.repeat(40));

    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.notice).toHaveBeenCalledWith(expect.stringContaining('The branch moved after the patch was made'));
    expect(api.createCommit).not.toHaveBeenCalled();
  });

  it('creates the prepare directory under RUNNER_TEMP', async () => {
    vi.stubEnv('INPUT_MODE', 'prepare');

    await run();

    const directory = String(Object.fromEntries(vi.mocked(core.setOutput).mock.calls)['directory']);
    expect(path.dirname(directory)).toBe(temp);
  });

  it('falls back to the system temp directory outside a runner', async () => {
    vi.stubEnv('INPUT_MODE', 'prepare');
    vi.stubEnv('GITHUB_WORKSPACE', '');
    vi.stubEnv('RUNNER_TEMP', '');

    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    const directory = String(Object.fromEntries(vi.mocked(core.setOutput).mock.calls)['directory']);
    expect(path.dirname(directory)).toBe(tmpdir());
    await rm(directory, { force: true, recursive: true });
  });

  it('falls back to the working directory for the checkout outside a runner', async () => {
    vi.stubEnv('GITHUB_WORKSPACE', '');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(repo);
    await artifactFromEdit(base);

    try {
      await run();
    } finally {
      cwd.mockRestore();
    }

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(api.createCommit).toHaveBeenCalledOnce();
  });
});
