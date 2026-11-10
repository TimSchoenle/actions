import { fileURLToPath } from 'node:url';

import { runAction } from 'actions-e2e';
import { describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/release/resolve-actions`: the shipped bundle, run against this
 * repository's own checkout. It reads files only, so every case runs offline.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const REPOSITORY = fileURLToPath(new URL('../../../..', import.meta.url));

function resolve(
  inputs: ProvidedInputs<ActionInput>,
  expected: ExpectedOutcome = 'success',
): Promise<ActionRunResult<ActionOutput>> {
  return runAction<ActionInput, ActionOutput>({
    actionDirectory: ACTION_DIRECTORY,
    env: { GITHUB_WORKSPACE: REPOSITORY },
    expect: expected,
    inputs: { exclude: 'scripts/templates', ...inputs },
  });
}

function list(result: ActionRunResult<ActionOutput>, output: ActionOutput): string[] {
  return JSON.parse(result.outputs[output] ?? 'null') as string[];
}

describe('resolve-actions', () => {
  it('resolves a composite to the helper its run step invokes', async () => {
    const result = await resolve({ targets: 'actions/common/find-patch' });

    expect(list(result, 'build-dirs')).toEqual(['actions/common/find-patch/helper']);
    expect(list(result, 'bundles')).toEqual(['actions/common/find-patch/helper/dist/index.js']);
    expect(list(result, 'source-paths')).toEqual(
      expect.arrayContaining(['actions/common/find-patch/**', 'packages/ts-util/**', 'bun.lock', '.bun-version']),
    );
  });

  it('adds the local actions a workflow runs', async () => {
    const result = await resolve({ workflows: '.github/workflows/verify-action-common-find-patch.yaml' });

    expect(list(result, 'build-dirs')).toEqual(
      expect.arrayContaining(['actions/common/create-patch/helper', 'actions/common/find-patch/helper']),
    );
  });

  it('finds every action when nothing is named, and builds this one among them', async () => {
    expect(list(await resolve({}), 'build-dirs')).toContain('actions/release/resolve-actions');
  });

  it('narrows to what a shared package change affects', async () => {
    const result = await resolve({ mode: 'affected', 'changed-files': 'packages/action-graph/src/index.ts' });

    expect(list(result, 'actions')).toEqual(
      expect.arrayContaining([
        'actions/release/build-actions/helper',
        'actions/release/install-built-actions/helper',
        'actions/release/resolve-actions',
      ]),
    );
    expect(list(result, 'actions')).not.toContain('actions/common/read-yaml');
  });

  it('fails on a target without a manifest', async () => {
    const result = await resolve({ targets: 'actions/common' }, 'failure');

    expect(result.errors.join('\n')).toMatch(/actions\/common: no action\.yml or action\.yaml found/);
  });

  it('fails on a path outside the workspace', async () => {
    const result = await resolve({ path: '../..' }, 'failure');

    expect(result.errors.join('\n')).toMatch(/'\.\.' segment/);
  });
});
