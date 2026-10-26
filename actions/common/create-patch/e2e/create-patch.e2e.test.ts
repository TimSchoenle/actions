import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAction, Workspace } from 'actions-e2e';
import { parseMetadata } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, WorkspaceFiles } from 'actions-e2e';

/**
 * End-to-end cases for `actions/common/create-patch`.
 *
 * upload-artifact is the runner's to run. These cases drive the shipped helper bundle over a real
 * repository, with `RUNNER_TEMP` pointed at a directory the case owns so the artifact directory the
 * helper reports can be read back after the run. The patch is then applied to a second clone, which
 * is the only proof that it is the change it claims to be.
 *
 * Nothing here reaches GitHub: the action runs in a job that holds no credential, by design.
 */

const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));

describe('create-patch', () => {
  let workspace: Workspace;
  let temp: string;
  let base: string;

  async function git(...args: string[]): Promise<string> {
    return (await workspace.git(['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', ...args])).trim();
  }

  beforeEach(async () => {
    temp = await mkdtemp(path.join(tmpdir(), 'create-patch-e2e-'));
    workspace = await Workspace.create({
      '.gitignore': 'node_modules/\n',
      'dist/index.js': 'old\n',
      'src/index.ts': 'old\n',
      'README.md': '# Old\n',
    });
    await workspace.initGit();
    await git('add', '--all');
    await git('commit', '--quiet', '-m', 'seed');
    base = await git('rev-parse', 'HEAD');
  });

  afterEach(async () => {
    await workspace.dispose();
    await rm(temp, { force: true, recursive: true });
  });

  function run(
    inputs: ProvidedInputs<ActionInput> = {},
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp },
      expect: expected,
      inputs: { artifact_name: 'e2e-patch', ...inputs },
      workspace,
    });
  }

  async function change(files: WorkspaceFiles): Promise<void> {
    await workspace.write(files);
  }

  it('records the scoped changes, including untracked files, and the patch applies to the base', async () => {
    await change({
      'dist/index.js': 'new\n',
      'dist/chunk.js': 'added\n',
      'src/index.ts': 'new\n',
      'node_modules/x.js': 'x\n',
    });

    const result = await run({ paths: 'dist/**' });

    expect(result.outputs).toEqual({
      artifact_name: 'e2e-patch',
      base_sha: base,
      directory: expect.stringContaining(path.join(temp, 'create-patch-e2e-patch-')),
      has_changes: 'true',
    });

    const directory = result.outputs.directory ?? '';
    expect((await readdir(directory)).sort()).toEqual(['changes.patch', 'metadata.json']);
    const metadata = parseMetadata(await readFile(path.join(directory, 'metadata.json'), 'utf8'));
    expect(metadata).toMatchObject({ baseSha: base, hasChanges: true });

    const clone = await Workspace.create();
    try {
      await clone.git(['clone', '--quiet', workspace.path, '.']);
      await clone.git(['apply', '--index', path.join(directory, 'changes.patch')]);
      const changed = (await clone.git(['diff', '--cached', '--name-only'])).trim().split('\n').sort();

      expect(changed).toEqual(['dist/chunk.js', 'dist/index.js']);
      expect(await clone.read('dist/chunk.js')).toBe('added\n');
    } finally {
      await clone.dispose();
    }
  });

  it('leaves the working tree as the build left it', async () => {
    await change({ 'README.md': '# New\n' });
    const before = await workspace.git(['status', '--porcelain', '-uall']);

    await run();

    expect(await workspace.git(['status', '--porcelain', '-uall'])).toBe(before);
  });

  it('reports no changes for a tree that matches HEAD within the paths', async () => {
    await change({ 'src/index.ts': 'new\n' });

    const result = await run({ paths: 'dist/** README.md' });

    expect(result.outputs.has_changes).toBe('false');
    expect(await readFile(path.join(result.outputs.directory ?? '', 'changes.patch'), 'utf8')).toBe('');
  });

  it('fails when the patch exceeds max_patch_bytes', async () => {
    await change({ 'dist/index.js': 'x'.repeat(4096) });

    const result = await run({ max_patch_bytes: '1024' }, 'failure');

    expect(result.errors.join('\n')).toContain('The patch exceeds max_patch_bytes (1024 bytes)');
    expect(result.outputs).toEqual({});
  });

  it('fails on an artifact name that could leave RUNNER_TEMP', async () => {
    const result = await run({ artifact_name: '../escape' }, 'failure');

    expect(result.errors.join('\n')).toContain('artifact_name must be');
    expect(await readdir(temp)).toEqual([]);
  });
});
