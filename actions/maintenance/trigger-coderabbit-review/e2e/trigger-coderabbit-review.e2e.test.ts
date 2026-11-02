import { fileURLToPath } from 'node:url';

import { commandInjectionPayload, expectCleanRejection, expectNoInjection, runAction, ScratchRepo } from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/maintenance/trigger-coderabbit-review`.
 *
 * The only identity CI has is the test app, and an app token is exactly what this action must
 * refuse: CodeRabbit ignores commands from apps, so posting with one would look like a success and
 * trigger nothing. The cases therefore assert the refusal against a real pull request, and that no
 * input can make the action post anything other than one of its fixed commands. The posting path
 * itself is covered by the unit tests, which fake GitHub.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('trigger-coderabbit-review', () => {
  const scratch = ScratchRepo.fromEnvironment('trigger-coderabbit-review');

  let defaultBranch: string;

  beforeAll(async () => {
    defaultBranch = await scratch.defaultBranch();
  });

  afterAll(() => scratch.teardown());

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

  function run(
    number: number,
    inputs: ProvidedInputs<ActionInput> = {},
    expected: ExpectedOutcome = 'any',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      expect: expected,
      inputs: {
        token: scratch.token,
        pr_url: `https://github.com/${scratch.repository}/pull/${number}`,
        ...inputs,
      },
      secrets: [scratch.token],
    });
  }

  async function expectNoCommandPosted(number: number): Promise<void> {
    const bodies = await scratch.issueComments(number);

    expect(bodies.filter((body) => body.includes('@coderabbitai'))).toEqual([]);
  }

  it('refuses an app installation token and posts nothing', async () => {
    const number = await openPullRequest('app-token');

    const result = await run(number, {}, 'failure');

    expectCleanRejection(result, /CodeRabbit ignores commands that do not come from a user account/);
    expect(result.outputs.triggered).toBeUndefined();
    await expectNoCommandPosted(number);
  });

  describe('the command input', () => {
    it.each([
      { name: 'an unknown command', value: 'pause' },
      { name: 'a second command appended', value: 'review\n@coderabbitai resolve' },
      { name: 'a workflow command', value: commandInjectionPayload('review') },
    ])('refuses $name before calling GitHub', async ({ value }) => {
      // Pull request 1 need not exist: validation has to fail before the first request.
      const result = await run(1, { command: value }, 'failure');

      expectCleanRejection(result, /Invalid command/);
      expectNoInjection(result);
    });
  });
});
