import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyBundleDirectory } from 'action-graph';
import { runAction, Workspace } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/release/build-actions`: the shipped helper bundle, run over a
 * throwaway checkout with a shell build command, as the composite runs it. Uploading needs the
 * runner, so the upload and the round trip through install-built-actions are the extra jobs in the
 * verify workflow.
 */

const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));
const SOURCE_SHA = 'b'.repeat(40);
const NODE_ACTION = "runs:\n  using: 'node24'\n  main: 'dist/main.js'\n  post: 'dist/post.js'\n";

describe('build-actions', () => {
  let workspace: Workspace;
  let temp: string;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(tmpdir(), 'build-actions-e2e-'));
    workspace = await Workspace.create({
      'actions/demo/action.yml': NODE_ACTION,
      'actions/demo/src/index.js': 'console.log("demo");\n',
      'actions/composite/action.yml': 'runs:\n  using: composite\n  steps: []\n',
    });
  });

  afterEach(async () => {
    await workspace.dispose();
    await rm(temp, { force: true, recursive: true });
  });

  function build(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp },
      expect: expected,
      inputs: {
        artifact_name: 'built-actions-e2e',
        build_command: 'mkdir -p dist && cp src/index.js dist/main.js && printf "post" > dist/post.js',
        build_dirs: 'actions/demo',
        source_sha: SOURCE_SHA,
        toolchain: 'node 24',
        ...inputs,
      },
      workspace,
    });
  }

  it('stages every entry point with a manifest the outputs pin', async () => {
    const result = await build({});
    const directory = result.outputs.directory ?? '';

    const verified = verifyBundleDirectory(directory, result.outputs.manifest_sha256 ?? '');
    expect(verified.manifest.files.map((file) => file.path)).toEqual([
      'actions/demo/dist/main.js',
      'actions/demo/dist/post.js',
    ]);
    expect(await readFile(path.join(directory, 'actions/demo/dist/main.js'), 'utf8')).toBe('console.log("demo");\n');
    expect(result.outputs).toMatchObject({ artifact_name: 'built-actions-e2e', retention_days: '1' });
  });

  it('fails when the build leaves out an entry point', async () => {
    const result = await build({ build_command: 'mkdir -p dist && cp src/index.js dist/main.js' }, 'failure');

    expect(result.errors.join('\n')).toMatch(/did not produce: actions\/demo\/dist\/post\.js/);
  });

  it('fails when the build command fails', async () => {
    const result = await build({ build_command: 'false' }, 'failure');

    expect(result.errors.join('\n')).toMatch(/failed in actions\/demo with exit code 1/);
  });

  it('refuses a directory that ships no bundle', async () => {
    const result = await build({ build_dirs: 'actions/composite' }, 'failure');

    expect(result.errors.join('\n')).toMatch(/runs on 'composite', which ships no bundle/);
  });

  it('refuses an artifact name upload-artifact would reject', async () => {
    const result = await build({ artifact_name: '../x' }, 'failure');

    expect(result.errors.join('\n')).toMatch(/artifact-name must be/);
  });
});
