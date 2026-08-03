import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';

/**
 * End-to-end cases for `actions/common/delete-branch`, replacing the two jobs of
 * `verify-action-common-delete-branch.yaml`.
 *
 * `repository` defaults to `${{ github.repository }}`, which the runner resolves and no case can.
 * Every case therefore passes it explicitly; omitting it is asserted on separately, so the
 * expression default cannot silently become a literal.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('delete-branch', () => {
  const scratch = ScratchRepo.fromEnvironment('delete-branch');

  afterAll(() => scratch.teardown());

  function run(branchName: string, expected: 'success' | 'failure' = 'success'): ReturnType<typeof runAction> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, repository: scratch.repository, branch_name: branchName },
      secrets: [scratch.token],
      expect: expected,
    });
  }

  it('deletes a branch that exists and reports it', async () => {
    const branch = scratch.branch('existing');
    await scratch.createBranch(branch);

    const result = await run(branch);

    expect(result.outputs).toEqual({ deleted: 'true' });
    await expect(scratch.refSha(branch)).resolves.toBeUndefined();
  });

  it('reports a branch that was already gone without failing', async () => {
    const result = await run(scratch.branch('never-created'));

    expect(result.outputs).toEqual({ deleted: 'false' });
  });

  // Not reachable from the workflow, where the runner would have filled `repository` in.
  it('fails when the repository is not owner/repo', async () => {
    const result = await runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, repository: 'no-owner', branch_name: 'main' },
      secrets: [scratch.token],
      expect: 'failure',
    });

    expect(result.errors.join('\n')).toContain('no-owner');
    expect(result.outputs).toEqual({});
  });
});
