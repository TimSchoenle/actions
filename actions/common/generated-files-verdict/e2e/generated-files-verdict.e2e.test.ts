import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
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
 * End-to-end cases for `actions/common/generated-files-verdict`.
 *
 * Each generator patch is made the way a workflow makes it, with the shipped `create-patch` helper
 * over a real repository, and moved into a directory named after its artifact, as download-artifact
 * lays several artifacts out. The helper bundle then runs its three modes over them. The download and
 * the upload of the merged patch need the runner, so the Round Trip jobs in the verify workflow cover
 * the composite.
 */

const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));
const CREATE_PATCH_HELPER_DIRECTORY = fileURLToPath(new URL('../../create-patch/helper', import.meta.url));

describe('generated-files-verdict', () => {
  let workspace: Workspace;
  let temp: string;
  let downloads: string;
  let base: string;

  /** Runs git in the workspace with a throwaway identity, and returns its trimmed output. */
  async function git(...args: string[]): Promise<string> {
    return (await workspace.git(['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', ...args])).trim();
  }

  beforeEach(async () => {
    temp = await mkdtemp(path.join(tmpdir(), 'generated-files-verdict-e2e-'));
    downloads = path.join(temp, 'downloads');
    await mkdir(downloads);
    workspace = await Workspace.create({ 'Cargo.lock': 'lock v1\n', 'README.md': '# Old\n' });
    await workspace.initGit();
    await git('add', '--all');
    await git('commit', '--quiet', '-m', 'seed');
    base = await git('rev-parse', 'HEAD');
  });

  afterEach(async () => {
    await workspace.dispose();
    await rm(temp, { force: true, recursive: true });
  });

  /**
   * Makes one generator's artifact: writes `files`, runs create-patch over `paths`, moves the
   * artifact directory to `downloads/<name>` and resets the tree, as the next generator job starts
   * from a clean checkout of the same commit.
   */
  async function generator(name: string, files: Record<string, string>, paths: string): Promise<void> {
    await workspace.write(files);
    const result = await runAction<CreateInput, CreateOutput>({
      actionDirectory: CREATE_PATCH_HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp },
      expect: 'success',
      inputs: { artifact_name: name, paths },
      workspace,
    });
    await rename(result.outputs.directory ?? '', path.join(downloads, name));
    await git('checkout', '--quiet', '--', '.');
  }

  /** Runs this action's helper bundle with `inputs`, expecting `expected`. */
  function helper(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp },
      expect: expected,
      inputs,
      workspace,
    });
  }

  it('evaluate reports pending generators in needs order and prepares their download', async () => {
    const result = await helper({
      mode: 'evaluate',
      needs: JSON.stringify({
        docs: { outputs: { artifact_name: 'docs', has_changes: 'true' }, result: 'success' },
        format: { outputs: {}, result: 'skipped' },
        lock: { outputs: { artifact_name: 'lock', has_changes: 'true' }, result: 'success' },
        test: { outputs: {}, result: 'failure' },
      }),
    });

    expect(result.outputs).toMatchObject({
      artifacts: '["docs","lock"]',
      download_pattern: '{docs,lock}',
      failed_jobs: 'test',
      has_pending: 'true',
      pending_jobs: 'docs lock',
    });
    expect(result.outputs.directory).toContain('generated-files-verdict-');
  });

  it('inspect and apply merge two generator patches into one working tree', async () => {
    await generator('docs', { 'README.md': '# New\n' }, 'README.md');
    await generator('lock', { 'Cargo.lock': 'lock v2\n' }, 'Cargo.lock');

    const inspected = await helper({ artifacts: '["docs","lock"]', directory: downloads, mode: 'inspect' });
    await helper({ artifacts: '["docs","lock"]', directory: downloads, mode: 'apply' });

    expect(inspected.outputs).toEqual({ base_sha: base });
    expect(await workspace.read('README.md')).toBe('# New\n');
    expect(await workspace.read('Cargo.lock')).toBe('lock v2\n');
  });

  it('apply fails, naming the artifact, when two generators change the same lines differently', async () => {
    await generator('first', { 'README.md': '# First\n' }, 'README.md');
    await generator('second', { 'README.md': '# Second\n' }, 'README.md');

    const result = await helper({ artifacts: '["first","second"]', directory: downloads, mode: 'apply' }, 'failure');

    expect(result.errors.join('\n')).toContain('second');
  });

  it('inspect fails on patches made from different commits', async () => {
    await generator('docs', { 'README.md': '# New\n' }, 'README.md');
    await git('commit', '--quiet', '--allow-empty', '-m', 'moved on');
    await generator('lock', { 'Cargo.lock': 'lock v2\n' }, 'Cargo.lock');

    const result = await helper({ artifacts: '["docs","lock"]', directory: downloads, mode: 'inspect' }, 'failure');

    expect(result.errors.join('\n')).toContain('different commits');
  });

  it.each(['inspect', 'apply'] as const)('%s refuses a patch larger than max_patch_bytes', async (mode) => {
    await generator('docs', { 'README.md': `# ${'long line '.repeat(50)}\n` }, 'README.md');

    const result = await helper(
      { artifacts: '["docs"]', directory: downloads, max_patch_bytes: '64', mode },
      'failure',
    );

    expect(result.errors.join('\n')).toMatch(/max_patch_bytes/);
  });
});
