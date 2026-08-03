import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/common/create-branch`, run against a real repository.
 *
 * These replace the three jobs of `verify-action-common-create-branch.yaml`. What they add over the
 * shell version is completeness: each case asserts the action's *entire* output set, so an output
 * that disappears or gains an unexpected value fails here, where the previous per-field `if` checks
 * could not notice either.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('create-branch', () => {
  const scratch = ScratchRepo.fromEnvironment('create-branch');

  let defaultBranch: string;
  let defaultSha: string;

  /** Runs the action under test with the credentials and repository bound to this suite. */
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
    const head = await scratch.refSha(defaultBranch);

    expect(head, `${scratch.repository} has no commit on ${defaultBranch}`).toBeDefined();
    defaultSha = head as string;
  });

  afterAll(() => scratch.teardown());

  it('creates a branch at the head of the default branch', async () => {
    const branch = scratch.branch('default-base');

    const result = await run({ branch_name: branch });

    expect(result.outputs).toEqual({ branch, base_branch: defaultBranch, sha: defaultSha, created: 'true' });
    await expect(scratch.headOf(branch, defaultSha)).resolves.toBe(defaultSha);
  });

  it('branches from an explicitly requested base branch', async () => {
    const base = scratch.branch('explicit-base');
    const baseSha = await scratch.createBranch(base);
    const child = scratch.branch('explicit-child');

    const result = await run({ branch_name: child, base_branch: base });

    expect(result.outputs).toEqual({ branch: child, base_branch: base, sha: baseSha, created: 'true' });
    await expect(scratch.headOf(child, baseSha)).resolves.toBe(baseSha);
  });

  it('leaves a diverged branch where it is, and rewinds it only when reset is requested', async () => {
    const branch = scratch.branch('reset');
    const initialSha = await scratch.createBranch(branch);
    const divergedSha = await scratch.commitFile(branch, `${branch}/diverge.txt`, 'diverged', 'test: diverge branch');

    expect(divergedSha).not.toBe(initialSha);

    const untouched = await run({ branch_name: branch, reset_branch: 'false' });

    expect(untouched.outputs).toEqual({
      branch,
      base_branch: defaultBranch,
      sha: divergedSha,
      created: 'false',
    });
    await expect(scratch.headOf(branch, divergedSha)).resolves.toBe(divergedSha);

    const reset = await run({ branch_name: branch, reset_branch: 'true' });

    expect(reset.outputs).toEqual({ branch, base_branch: defaultBranch, sha: initialSha, created: 'true' });
    await expect(scratch.headOf(branch, initialSha)).resolves.toBe(initialSha);
  });

  // Not portable to the shell version: asserting on a *failed* step there needs `continue-on-error`
  // plus a second step to inspect the outcome, which is why no verify workflow asserts an error path.
  it('fails with the offending branch named when the base branch does not exist', async () => {
    const branch = scratch.branch('missing-base');
    const missing = `${branch}-does-not-exist`;

    const result = await run({ branch_name: branch, base_branch: missing }, 'failure');

    expect(result.errors).toEqual([
      `Could not find SHA for base branch '${missing}' in repository: ${scratch.repository}`,
    ]);
    expect(result.outputs).toEqual({});
    await expect(scratch.refSha(branch)).resolves.toBeUndefined();
  });
});
