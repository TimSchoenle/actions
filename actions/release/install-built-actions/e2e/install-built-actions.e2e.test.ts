import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256Hex, stageBundles } from 'action-graph';
import { runAction, Workspace } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type { StagedBundles } from 'action-graph';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/release/install-built-actions`: the shipped helper bundle in both
 * modes, over an artifact directory staged the way build-actions stages one, as download-artifact
 * would leave it. The download itself and the artifact record lookup need the runner and a real run,
 * so they are the extra jobs in the verify workflow.
 */

const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));

/** Whether this machine lets the test create the symbolic link the refusal case needs. */
const SYMLINKS_SUPPORTED = await Workspace.symlinksSupported();

describe('install-built-actions', () => {
  let workspace: Workspace;
  let temp: string;
  let staged: StagedBundles;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(tmpdir(), 'install-built-actions-e2e-'));
    const build = path.join(temp, 'build');
    await mkdir(path.join(build, 'actions/demo/dist'), { recursive: true });
    await writeFile(path.join(build, 'actions/demo/dist/index.js'), 'fresh();\n');
    staged = stageBundles(build, ['actions/demo'], ['actions/demo/dist/index.js'], path.join(temp, 'download'), {
      sourceSha: 'c'.repeat(40),
      toolchain: '',
      generatedBy: 'e2e',
    });
    workspace = await Workspace.create({
      'actions/demo/action.yml': "runs:\n  using: 'node24'\n  main: 'dist/index.js'\n",
      'actions/demo/dist/index.js': 'committed();\n',
    });
  });

  afterEach(async () => {
    await workspace.dispose();
    await rm(temp, { force: true, recursive: true });
  });

  function helper(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp, GITHUB_RUN_ID: '42' },
      expect: expected,
      inputs: {
        artifact_id: '7',
        expected_manifest_sha256: staged.manifestSha256,
        repository: 'owner/repo',
        ...inputs,
      },
      workspace,
    });
  }

  it('prepares an empty download directory for this run', async () => {
    const result = await helper({ mode: 'prepare' });

    expect(result.outputs).toMatchObject({ artifact_id: '7', run_id: '42' });
    expect(path.dirname(result.outputs.directory ?? '')).toBe(temp);
  });

  it('installs the verified bundle over the committed one and exports the manifest path', async () => {
    const result = await helper({ mode: 'install', directory: staged.directory });

    expect(await readFile(path.join(workspace.path, 'actions/demo/dist/index.js'), 'utf8')).toBe('fresh();\n');
    expect(result.exportedEnv['BUILT_ACTIONS_MANIFEST']).toBe(path.join(staged.directory, 'bundles.json'));
  });

  it('refuses a wrong manifest hash and leaves the checkout alone', async () => {
    const result = await helper(
      { mode: 'install', directory: staged.directory, expected_manifest_sha256: sha256Hex('x') },
      'failure',
    );

    expect(result.errors.join('\n')).toMatch(/bundles\.json has SHA-256/);
    expect(await readFile(path.join(workspace.path, 'actions/demo/dist/index.js'), 'utf8')).toBe('committed();\n');
  });

  it('refuses a file the manifest does not list', async () => {
    await writeFile(path.join(staged.directory, 'actions/demo/dist/extra.js'), 'evil();');
    const result = await helper({ mode: 'install', directory: staged.directory }, 'failure');

    expect(result.errors.join('\n')).toMatch(/does not list: actions\/demo\/dist\/extra\.js/);
  });

  it.skipIf(!SYMLINKS_SUPPORTED)('refuses a symbolic link in the artifact', async () => {
    await symlink(path.join(temp, 'build'), path.join(staged.directory, 'actions/demo/linked'));
    const result = await helper({ mode: 'install', directory: staged.directory }, 'failure');

    expect(result.errors.join('\n')).toMatch(/symbolic link/);
  });

  it('refuses expected-artifact-digest without a token, before creating anything', async () => {
    const result = await helper({ mode: 'prepare', expected_artifact_digest: 'd'.repeat(64) }, 'failure');

    expect(result.errors.join('\n')).toMatch(/needs github-token/);
    expect(result.outputs.directory).toBeUndefined();
  });
});
