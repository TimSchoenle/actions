import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/common/close-pull-request`, replacing the three jobs of
 * `verify-action-common-close-pull-request.yaml`.
 *
 * The fixtures no longer go through `create-pull-request`. That action is a separate composite whose
 * own failures used to surface here as a confusing "cannot proceed with close test"; opening the
 * pull request through the API instead keeps a failure in this suite attributable to this action.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('close-pull-request', () => {
  const scratch = ScratchRepo.fromEnvironment('close-pull-request');

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

  /** Opens a pull request carrying one commit, which is the minimum GitHub will accept. */
  async function openPullRequest(caseName: string): Promise<number> {
    const branch = scratch.branch(caseName);

    await scratch.createBranch(branch);
    await scratch.commitFile(
      branch,
      `${branch}/file.txt`,
      `content for ${caseName}\n`,
      `test: fixture for ${caseName}`,
    );

    return scratch.createPullRequest(branch, defaultBranch, `[e2e] ${caseName}`);
  }

  beforeAll(async () => {
    defaultBranch = await scratch.defaultBranch();
  });

  afterAll(() => scratch.teardown());

  it('closes an open pull request', async () => {
    const number = await openPullRequest('close');

    const result = await run({ pull_request_id: String(number) });

    expect(result.outputs).toEqual({ closed: 'true' });
    await expect(scratch.pullRequest(number)).resolves.toMatchObject({ state: 'closed', merged: false });
  });

  it('leaves a closing comment when one is requested', async () => {
    const number = await openPullRequest('close-with-comment');
    const comment = 'Closed by the end-to-end suite.';

    const result = await run({ pull_request_id: String(number), comment });

    expect(result.outputs).toEqual({ closed: 'true' });
    await expect(scratch.pullRequest(number)).resolves.toMatchObject({ state: 'closed' });
    await expect(scratch.issueComments(number)).resolves.toEqual([comment]);
  });

  // The shell version ran this case and asserted nothing at all about it.
  it('reports a pull request that does not exist without failing', async () => {
    const result = await run({ pull_request_id: '999999999' });

    expect(result.outputs).toEqual({ closed: 'false' });
  });

  it('does not comment on a pull request it could not close', async () => {
    const result = await run({ pull_request_id: '999999999', comment: 'should never be posted' });

    expect(result.outputs).toEqual({ closed: 'false' });
  });

  it('fails when the pull request id is not a number', async () => {
    const result = await run({ pull_request_id: 'not-a-number' }, 'failure');

    expect(result.errors.join('\n')).toContain('not-a-number');
  });
});
