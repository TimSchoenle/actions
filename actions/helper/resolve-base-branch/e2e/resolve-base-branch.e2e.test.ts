import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/helper/resolve-base-branch`, replacing the five jobs of
 * `verify-action-helper-resolve-base-branch.yaml`, including its four-way input-validation matrix.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('resolve-base-branch', () => {
  const scratch = ScratchRepo.fromEnvironment('resolve-base-branch');

  let defaultBranch: string;

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, repository: scratch.repository, ...inputs },
      secrets: [scratch.token],
      expect: expected,
    });
  }

  beforeAll(async () => {
    defaultBranch = await scratch.defaultBranch();
  });

  afterAll(() => scratch.teardown());

  it('resolves the repository default branch when none is requested', async () => {
    const result = await run({});

    expect(result.outputs).toEqual({ base_branch: defaultBranch });
  });

  it('returns a requested branch that exists', async () => {
    const branch = scratch.branch('exists');
    await scratch.createBranch(branch);

    const result = await run({ branch_name: branch });

    expect(result.outputs).toEqual({ base_branch: branch });
  });

  it('reports nothing for a missing branch when failing silently', async () => {
    const result = await run({ branch_name: scratch.branch('absent'), silent_fail: 'true' });

    expect(result.outputs['base_branch'] ?? '').toBe('');
  });

  it('returns a missing branch unchecked when existence checking is off', async () => {
    const branch = scratch.branch('unchecked');

    const result = await run({ branch_name: branch, check_if_exist: 'false' });

    expect(result.outputs).toEqual({ base_branch: branch });
  });

  // The workflow's four-way validation matrix, which cost four runners.
  it.each([
    { name: 'a repository without an owner', inputs: { repository: 'actions-testing' }, message: 'actions-testing' },
    {
      name: 'a repository with a trailing path',
      inputs: { repository: 'TimSchoenle/actions/extra' },
      message: 'TimSchoenle/actions/extra',
    },
    {
      name: 'a non-boolean check_if_exist',
      inputs: { branch_name: 'main', check_if_exist: 'maybe' },
      message: 'check_if_exist',
    },
    {
      name: 'a non-boolean silent_fail',
      inputs: { branch_name: 'main', silent_fail: 'perhaps' },
      message: 'silent_fail',
    },
  ])('rejects $name', async ({ inputs, message }) => {
    const result = await run(inputs, 'failure');

    expect(result.errors.join('\n')).toContain(message);
    expect(result.outputs).toEqual({});
  });

  it('fails loudly for a missing branch when not failing silently', async () => {
    const branch = scratch.branch('absent-loud');

    const result = await run({ branch_name: branch }, 'failure');

    expect(result.errors.join('\n')).toContain(branch);
  });
});
