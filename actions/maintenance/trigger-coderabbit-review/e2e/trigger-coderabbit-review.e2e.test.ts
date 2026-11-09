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
        base_branch: '',
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

  describe('in a workflow_run job', () => {
    /** Runs with `pr_url` empty against a workflow_run event for `pullRequests`, written into the workspace. */
    function runFromEvent(
      workflowRun: Record<string, unknown>,
      expected: ExpectedOutcome,
    ): Promise<ActionRunResult<ActionOutput>> {
      const event = {
        repository: { full_name: scratch.repository, id: 1 },
        workflow_run: {
          event: 'pull_request',
          head_repository: { full_name: scratch.repository },
          head_sha: 'a'.repeat(40),
          pull_requests: [],
          ...workflowRun,
        },
      };

      return runAction<ActionInput, ActionOutput>({
        actionDirectory: ACTION_DIRECTORY,
        env: {
          GITHUB_EVENT_NAME: 'workflow_run',
          GITHUB_EVENT_PATH: 'event.json',
          GITHUB_REPOSITORY: scratch.repository,
        },
        expect: expected,
        files: { 'event.json': JSON.stringify(event) },
        inputs: { base_branch: defaultBranch, pr_url: '', token: scratch.token },
        secrets: [scratch.token],
      });
    }

    it('skips a run from a fork without using the token', async () => {
      const result = await runFromEvent({ head_repository: { full_name: 'someone-else/fork' } }, 'success');

      expect(result.outputs).toMatchObject({ skip_reason: 'fork', triggered: 'false' });
    });

    it('skips a run that was not started by a pull_request event', async () => {
      const result = await runFromEvent({ event: 'push' }, 'success');

      expect(result.outputs).toMatchObject({ skip_reason: 'not-pull-request', triggered: 'false' });
    });

    it('reaches the token check for the pull request the run belongs to, and posts nothing with an app token', async () => {
      const number = await openPullRequest('workflow-run');
      const head = await scratch.headOf(scratch.branch('workflow-run'));

      const result = await runFromEvent(
        {
          head_sha: head,
          pull_requests: [{ base: { ref: defaultBranch, repo: { id: 1 } }, head: { sha: head }, number }],
        },
        'failure',
      );

      expectCleanRejection(result, /CodeRabbit ignores commands that do not come from a user account/);
      await expectNoCommandPosted(number);
    });
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
