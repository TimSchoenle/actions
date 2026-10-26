import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoInjection,
  expectSecretNotLeaked,
  runAction,
  ScratchRepo,
} from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/maintenance/timed-auto-merge`, run against the scratch repository.
 *
 * None of these cases approves or merges. A real approval needs a second identity, since GitHub
 * refuses a review from the pull request's author, and a real auto-merge needs a branch protection
 * rule on the scratch repository that every other suite would then have to satisfy. The approving
 * path is covered by the unit tests against a faked API; what only the real API can show is covered
 * here: the listing, the branch match against real refs, the age check against GitHub's timestamps,
 * the commit verification against GitHub's signature data, and that each refusal leaves the pull
 * request without a review.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

/** Escapes a branch name for use as a literal inside a regex-mode pattern. */
function literal(branch: string): string {
  return branch.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

describe('timed-auto-merge', () => {
  const scratch = ScratchRepo.fromEnvironment('timed-auto-merge');

  let defaultBranch: string;
  let authorId: string;

  beforeAll(async () => {
    defaultBranch = await scratch.defaultBranch();
    authorId = String(await scratch.accountId());
  });

  afterAll(() => scratch.teardown());

  async function openPullRequest(caseName: string): Promise<{ branch: string; number: number }> {
    const branch = scratch.branch(caseName);

    await scratch.createBranch(branch);
    await scratch.commitFile(
      branch,
      `${branch}/file.txt`,
      `content for ${caseName}\n`,
      `test: fixture for ${caseName}`,
    );

    return { branch, number: await scratch.createPullRequest(branch, defaultBranch, `[e2e] ${caseName}`) };
  }

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      expect: expected,
      inputs: {
        repository: scratch.repository,
        token: scratch.token,
        trusted_authors: authorId,
        ...inputs,
      },
      secrets: [scratch.token],
    });
  }

  it('leaves a matching pull request alone until it is old enough', async () => {
    const { branch, number } = await openPullRequest('young');

    const result = await run({ branch_pattern: `^${literal(branch)}$`, pattern_mode: 'regex', time_elapsed: '1d' });

    expect(JSON.parse(result.outputs.skipped ?? '')).toEqual([{ number, reason: 'too-young' }]);
    expect(result.outputs.approved).toBe('[]');
    expect(result.outputs.failed).toBe('[]');
    expect(result.stepSummary).toContain(`| #${number} |`);
    await expect(scratch.reviewStates(number)).resolves.toEqual([]);
  });

  it('refuses a pull request whose commits are not by a trusted author', async () => {
    const { branch, number } = await openPullRequest('untrusted');

    const result = await run({
      branch_pattern: `${branch}%`,
      minimum_age: '0s',
      time_elapsed: '0s',
      // A real account that is not the one that wrote the fixture's commit.
      trusted_authors: '1',
    });

    expect(JSON.parse(result.outputs.skipped ?? '')).toEqual([{ number, reason: 'commits-unverified' }]);
    expect(result.outputs.approved).toBe('[]');
    await expect(scratch.reviewStates(number)).resolves.toEqual([]);
  });

  it('ignores open pull requests whose branch does not match', async () => {
    const { branch } = await openPullRequest('unmatched');

    const result = await run({ branch_pattern: `${branch}-does-not-exist%` });

    expect(result.outputs.skipped).toBe('[]');
    expect(result.outputs.approved).toBe('[]');
    expect(result.outputs.failed).toBe('[]');
  });

  describe('rejects configuration before touching any pull request', () => {
    it.each([
      {
        inputs: { time_elapsed: '0s' },
        message: /shorter than 'minimum_age'/,
        name: 'a time_elapsed below minimum_age',
      },
      {
        inputs: { time_elapsed: 'tomorrow' },
        message: /Invalid 'time_elapsed'/,
        name: 'a time_elapsed GNU date would read',
      },
      {
        inputs: { merge_method: 'admin' },
        message: /Invalid 'merge_method'/,
        name: 'a merge method that is a gh flag',
      },
      { inputs: { trusted_authors: '*' }, message: /Invalid 'trusted_authors'/, name: 'a wildcard author list' },
      { inputs: { branch_pattern: '' }, message: /must not be empty/, name: 'an empty branch pattern' },
    ] satisfies { inputs: ProvidedInputs<ActionInput>; message: RegExp; name: string }[])(
      '$name',
      async ({ inputs, message }) => {
        const result = await run(inputs, 'failure');

        expectCleanRejection(result, message);
        expect(result.outputs).toEqual({});
      },
    );
  });

  it('cannot be made to forge workflow commands through the branch pattern', async () => {
    const result = await run({ branch_pattern: commandInjectionPayload('no-such-branch-'), pattern_mode: 'regex' });

    expectNoInjection(result);
    expectSecretNotLeaked(result, scratch.token);
    expect(result.outputs.approved).toBe('[]');
  });
});
