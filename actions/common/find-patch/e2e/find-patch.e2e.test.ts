import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAction, Workspace } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type {
  ActionInput as CreateInput,
  ActionOutput as CreateOutput,
} from '../../create-patch/helper/src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/common/find-patch`.
 *
 * Each case builds its artifact the way a workflow does, with the shipped `create-patch` helper over
 * a real repository, and hands the directory it wrote to this action's helper in inspect mode, as
 * download-artifact would. Listing a run's artifacts needs a run that has some, so lookup mode is
 * exercised against the real API by the Round Trip job in the verify workflow instead.
 */

const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));
const CREATE_PATCH_HELPER_DIRECTORY = fileURLToPath(new URL('../../create-patch/helper', import.meta.url));

describe('find-patch', () => {
  let workspace: Workspace;
  let temp: string;
  let base: string;

  async function git(...args: string[]): Promise<string> {
    return (await workspace.git(['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', ...args])).trim();
  }

  beforeEach(async () => {
    temp = await mkdtemp(path.join(tmpdir(), 'find-patch-e2e-'));
    workspace = await Workspace.create({ 'README.md': '# Old\n', 'src/index.ts': 'old\n' });
    await workspace.initGit();
    await git('add', '--all');
    await git('commit', '--quiet', '-m', 'seed');
    base = await git('rev-parse', 'HEAD');
  });

  afterEach(async () => {
    await workspace.dispose();
    await rm(temp, { force: true, recursive: true });
  });

  /** Runs the create-patch helper over the checkout, and returns the artifact directory it wrote. */
  async function createPatch(paths = '.'): Promise<string> {
    const result = await runAction<CreateInput, CreateOutput>({
      actionDirectory: CREATE_PATCH_HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp },
      expect: 'success',
      inputs: { artifact_name: 'e2e-patch', paths },
      workspace,
    });

    return result.outputs.directory ?? '';
  }

  function inspect(
    directory: string,
    inputs: ProvidedInputs<ActionInput> = {},
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp },
      expect: expected,
      inputs: {
        artifact_name: 'e2e-patch',
        directory,
        mode: 'inspect',
        repository: 'owner/repo',
        ...inputs,
      },
      workspace,
    });
  }

  it('reports changes for the patch of a changed tree, made from HEAD', async () => {
    await workspace.write({ 'README.md': '# New\n' });

    const directory = await createPatch();

    const result = await inspect(directory, { expected_head_sha: base });

    expect(result.outputs).toEqual({ base_sha: base, directory, has_changes: 'true', outcome: 'changes' });
  });

  it('reports no_changes for the patch of a tree that matches HEAD within the paths', async () => {
    await workspace.write({ 'src/index.ts': 'new\n' });

    const directory = await createPatch('README.md');

    const result = await inspect(directory, { expected_head_sha: base });

    expect(result.outputs).toEqual({ base_sha: base, directory, has_changes: 'false', outcome: 'no_changes' });
  });

  it('reports branch_moved for a patch made before the branch moved on', async () => {
    await workspace.write({ 'README.md': '# New\n' });
    const directory = await createPatch();
    await git('commit', '--quiet', '--allow-empty', '-m', 'moved on');
    const head = await git('rev-parse', 'HEAD');

    const result = await inspect(directory, { expected_head_sha: head });

    expect(result.outputs).toEqual({ base_sha: base, directory, has_changes: 'false', outcome: 'branch_moved' });
    expect(result.notices.join('\n')).toContain(`was made from ${base}, not ${head}`);
  });

  it('fails on a patch altered after create-patch wrote it, rather than reporting nothing to commit', async () => {
    await workspace.write({ 'README.md': '# New\n' });
    const directory = await createPatch();
    await writeFile(path.join(directory, 'changes.patch'), 'diff --git a/x b/x\n');

    const result = await inspect(directory, {}, 'failure');

    expect(result.errors.join('\n')).toContain('The patch artifact is invalid');
    expect(result.outputs).toEqual({});
  });

  it('fails on a patch larger than max_patch_bytes', async () => {
    await workspace.write({ 'README.md': 'x'.repeat(4096) });

    const result = await inspect(await createPatch(), { max_patch_bytes: '1024' }, 'failure');

    expect(result.errors.join('\n')).toContain('above max_patch_bytes (1024)');
  });

  it('fails in lookup mode on an artifact name that could leave RUNNER_TEMP, before any request', async () => {
    const result = await runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp },
      expect: 'failure',
      inputs: { artifact_name: '../escape', mode: 'lookup', repository: 'owner/repo', run_id: '1', token: 'unused' },
      workspace,
    });

    expect(result.errors.join('\n')).toContain('artifact_name must be');
  });
});
