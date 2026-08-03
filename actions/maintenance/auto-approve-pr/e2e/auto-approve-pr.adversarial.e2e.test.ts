import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoInjection,
  INPUT_HOSTILE_CHARACTERS,
  oversized,
  REDOS_PATTERNS,
  runAction,
  ScratchRepo,
} from 'actions-e2e';
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * Hostile cases for `actions/maintenance/auto-approve-pr`, run against a real repository.
 *
 * The most consequential action in the repository: an approval it grants can satisfy a branch
 * protection rule and let code merge without a human ever reading it. Its own suite needs a second
 * identity because GitHub refuses a self-review — but *nothing here approves anything*, which is what
 * lets these run without one. Every case drives the action to a decision and asserts the decision was
 * "no", because the only outcome that matters is that no input can talk it into "yes".
 *
 * The three gates it composes — the accepted-author list, the branch pattern and the commit
 * verification — are each attacked separately, and each must fail closed on its own.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('auto-approve-pr under hostile input', () => {
  const scratch = ScratchRepo.fromEnvironment('auto-approve-pr-adv');

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'any',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: {
        token: scratch.token,
        user_ids: '1',
        branch_pattern: '^release-please--branches--main$',
        pr_url: `https://github.com/${scratch.repository}/pull/1`,
        ...inputs,
      },
      secrets: [scratch.token],
      expect: expected,
    });
  }

  /** The one line this action prints when it has approved something. No case may produce it. */
  function expectNotApproved(result: ActionRunResult<ActionOutput>): void {
    expect(result.stdout, 'no hostile input may result in an approval').not.toContain('Pull request approved');
  }

  afterAll(() => scratch.teardown());

  describe('the accepted-author list', () => {
    it.each([
      { name: 'a wildcard', value: '*' },
      { name: 'a name rather than an id', value: 'octocat' },
      { name: 'a negative id', value: '-1' },
      { name: 'zero', value: '0' },
      { name: 'a float', value: '1.5' },
      { name: 'scientific notation', value: '1e3' },
      { name: 'an empty list', value: '' },
      { name: 'only separators', value: ',,,' },
      { name: 'a valid id beside an invalid one', value: '1,octocat' },
    ])('refuses $name rather than widening who may be approved', async ({ value }) => {
      const result = await run({ user_ids: value }, 'failure');

      expectCleanRejection(result);
      expectNotApproved(result);
      expectNoInjection(result);
    });
  });

  describe('the branch pattern', () => {
    it.each(REDOS_PATTERNS)(
      'does not burn a runner on $name',
      async ({ pattern }) => {
        const started = Date.now();

        const result = await run({ branch_pattern: pattern });

        expect(Date.now() - started, 'an approval gate must return').toBeLessThan(60_000);
        expectNotApproved(result);
        expectNoInjection(result);
      },
      120_000,
    );

    it.each([
      { name: 'an unterminated group', value: '^(unclosed' },
      { name: 'an inverted character range', value: '[z-a]' },
      { name: 'a lone quantifier', value: '*' },
    ])('fails closed on $name rather than treating it as a match', async ({ value }) => {
      const result = await run({ branch_pattern: value });

      expectNotApproved(result);
      expectNoInjection(result);
    });

    it('refuses an empty branch pattern rather than matching every branch', async () => {
      // `branch_pattern` is required here, unlike in `verify-branch-name` where an empty pattern is a
      // documented opt-out. An approval gate that matched every branch would be no gate at all.
      const result = await run({ branch_pattern: '' }, 'failure');

      expectCleanRejection(result);
      expectNotApproved(result);
    });
  });

  describe('the pull request it is pointed at', () => {
    it.each([
      { name: 'a non-GitHub host', value: 'https://example.com/owner/repo/pull/1' },
      { name: 'a scheme that is not https', value: 'file:///etc/passwd' },
      { name: 'a bare path', value: '/owner/repo/pull/1' },
      { name: 'an empty URL', value: '' },
      { name: 'an issue rather than a pull request', value: `https://github.com/${'o/r'}/issues/1` },
      { name: 'a pull request that does not exist', value: `https://github.com/${'o/r'}/pull/999999` },
    ])('fails closed on $name', async ({ value }) => {
      const result = await run({ pr_url: value });

      expectNotApproved(result);
      expectNoInjection(result);
    });
  });

  describe('the flags that decide how strict it is', () => {
    it.each(['yes', '1', 'on', 'off'])('refuses the ambiguous reject_forks value %j', async (value) => {
      const result = await run({ reject_forks: value }, 'failure');

      // A flag a typo turns off is a fork check a typo removes.
      expectCleanRejection(result);
      expectNotApproved(result);
    });

    it.each(['yes', '1', 'on', 'off'])('refuses the ambiguous ignore_empty_prs value %j', async (value) => {
      const result = await run({ ignore_empty_prs: value }, 'failure');

      expectCleanRejection(result);
      expectNotApproved(result);
    });
  });

  describe('injection through the inputs', () => {
    it.each([
      { name: 'the pull request URL', input: 'pr_url' as const },
      { name: 'the branch pattern', input: 'branch_pattern' as const },
      { name: 'the approval message', input: 'auto_approve_message' as const },
    ])('forges nothing through $name', async ({ input }) => {
      const result = await run({ [input]: commandInjectionPayload('feature/x') });

      expectNoInjection(result);
      expectNotApproved(result);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('forges nothing through $name ($risk) in the URL', async ({ value }) => {
      const result = await run({ pr_url: `https://github.com/o/r/pull/1${value}` });

      expectNoInjection(result);
      expectNotApproved(result);
    });

    it('never echoes the token', async () => {
      const result = await run({ pr_url: commandInjectionPayload('https://github.com/o/r/pull/1') });

      expect(result.stdout).not.toContain(scratch.token);
      expect(result.stderr).not.toContain(scratch.token);
    });

    it('publishes nothing to the environment of later steps', async () => {
      const result = await run({});

      expect(result.exportedEnv).toEqual({});
      expect(result.addedPath).toEqual([]);
    });

    it('handles an approval message far longer than a person would write', async () => {
      const result = await run({ auto_approve_message: oversized(60_000) });

      expect(result.stderr).not.toContain('UnhandledPromiseRejection');
      expectNotApproved(result);
    });
  });
});
