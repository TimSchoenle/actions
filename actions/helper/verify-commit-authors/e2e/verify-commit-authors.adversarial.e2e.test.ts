import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoInjection,
  INPUT_HOSTILE_CHARACTERS,
  oversized,
  runAction,
  ScratchRepo,
} from 'actions-e2e';
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * Hostile cases for `actions/helper/verify-commit-authors`, run against a real repository.
 *
 * A gate, and one whose answer is a single boolean that a later job acts on — so the only failure
 * mode that matters is `verified=true` reached by any route other than "every commit was authored by
 * an accepted user and signed". Every case here tries to reach it: through a `user_ids` list that
 * should not parse, through a `pr_url` that names something other than a pull request, and through an
 * error path that might report success by omission.
 *
 * The action fails *closed* by design, so almost every hostile input is expected to fail the step
 * rather than to publish `verified=false`. Both are acceptable; `verified=true` never is.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('verify-commit-authors under hostile input', () => {
  const scratch = ScratchRepo.fromEnvironment('verify-commit-authors-adv');

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'any',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: {
        github_token: scratch.token,
        pr_url: `https://github.com/${scratch.repository}/pull/1`,
        user_ids: '1',
        ...inputs,
      },
      secrets: [scratch.token],
      expect: expected,
    });
  }

  /** The one outcome no hostile input may produce, whatever else the run did. */
  function expectNotVerified(result: ActionRunResult<ActionOutput>): void {
    expect(result.outputs['verified'], 'a gate must never report success on an input it could not process').not.toBe(
      'true',
    );
  }

  afterAll(() => scratch.teardown());

  describe('the accepted-user list', () => {
    it.each([
      { name: 'a wildcard', value: '*' },
      { name: 'a name rather than an id', value: 'octocat' },
      { name: 'a negative id', value: '-1' },
      { name: 'zero', value: '0' },
      { name: 'a float', value: '1.5' },
      { name: 'scientific notation', value: '1e3' },
      { name: 'hexadecimal', value: '0x1' },
      { name: 'an id past the safe integer range', value: '9007199254740993' },
      { name: 'a leading plus', value: '+1' },
      { name: 'whitespace only', value: '   ' },
      { name: 'an empty list', value: '' },
      { name: 'only separators', value: ',,,' },
      { name: 'a valid id beside an invalid one', value: '1,octocat' },
      { name: 'an id with a null-ish suffix', value: '1abc' },
      { name: 'a SQL-looking value', value: '1 OR 1=1' },
    ])('refuses $name rather than widening what it accepts', async ({ value }) => {
      const result = await run({ user_ids: value }, 'failure');

      expectCleanRejection(result);
      expectNotVerified(result);
      expectNoInjection(result);
    });

    it('accepts a well-formed list, so the gate is not simply always closed', async () => {
      // Reaches the API and fails there — pull request 1 may not exist — but it must get past the
      // parse, which is what distinguishes a rejected list from a rejected pull request.
      const result = await run({ user_ids: ' 1 , 2 ,2 ' });

      expect(result.errors.join('\n')).not.toMatch(/Invalid user ID|No accepted user IDs/);
    });
  });

  describe('the pull request it is pointed at', () => {
    it.each([
      { name: 'an issue rather than a pull request', path: 'issues/1' },
      { name: 'a commit rather than a pull request', path: 'commit/HEAD' },
      { name: 'the repository root', path: '' },
      { name: 'a pull request that does not exist', path: 'pull/999999' },
      { name: 'a non-numeric pull request', path: 'pull/abc' },
      { name: 'a negative pull request', path: 'pull/-1' },
    ])('fails closed on $name', async ({ path }) => {
      const result = await run({ pr_url: `https://github.com/${scratch.repository}/${path}` }, 'failure');

      expectNotVerified(result);
      expectNoInjection(result);
    });

    // Worth its own case because the outcome surprises: GitHub's GraphQL `resource(url:)` normalises
    // the traversal away and resolves a real pull request, so the step *succeeds* and answers about
    // whatever the URL collapsed to. That is not a bypass — the answer is still `verified=false` —
    // but it does mean the URL in the log is not necessarily the URL that was verified.
    it('answers about the pull request a traversal collapses to, and never verifies it blindly', async () => {
      const result = await run({
        pr_url: `https://github.com/${scratch.repository}/pull/1/../../../other/repo/pull/1`,
      });

      expectNotVerified(result);
      expectNoInjection(result);
    });

    it.each([
      { name: 'a non-GitHub host', value: 'https://example.com/owner/repo/pull/1' },
      { name: 'a scheme that is not https', value: 'file:///etc/passwd' },
      { name: 'a javascript URL', value: 'javascript:alert(1)' },
      { name: 'a bare path', value: '/owner/repo/pull/1' },
      { name: 'an empty URL', value: '' },
      { name: 'a URL with credentials', value: 'https://user:pass@github.com/owner/repo/pull/1' },
    ])('fails closed on $name', async ({ value }) => {
      const result = await run({ pr_url: value }, 'failure');

      expectNotVerified(result);
      // A step log is a durable artefact that outlives the run, so userinfo comes off before the URL
      // reaches it — an input that accepts a URL accepts one carrying a token too.
      expect(result.stdout, 'a URL that carried credentials must not be echoed whole').not.toContain('user:pass@');
      expectNoInjection(result);
    });

    // Worth pinning rather than defending: the action verifies whichever pull request the URL names,
    // because that is the only thing it can do. A workflow that passes anything other than
    // `github.event.pull_request.html_url` is choosing what gets verified, and should know it.
    it('names the pull request it was given in its own log, quoted', async () => {
      const result = await run({ pr_url: `https://github.com/${scratch.repository}/pull/1` });

      expect(result.stdout).toContain(`"https://github.com/${scratch.repository}/pull/1"`);
    });
  });

  describe('injection through the inputs', () => {
    it.each([
      { name: 'the pull request URL', input: 'pr_url' as const },
      { name: 'the accepted ids', input: 'user_ids' as const },
    ])('forges nothing through $name', async ({ input }) => {
      const result = await run({ [input]: commandInjectionPayload('https://github.com/o/r/pull/1') }, 'failure');

      expectNoInjection(result);
      expectNotVerified(result);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('forges nothing through $name ($risk) in the URL', async ({ value }) => {
      const result = await run({ pr_url: `https://github.com/o/r/pull/1${value}` }, 'failure');

      expectNoInjection(result);
      expectNotVerified(result);
    });

    it('never echoes the token', async () => {
      const result = await run({ pr_url: commandInjectionPayload('https://github.com/o/r/pull/1') }, 'failure');

      expect(result.stdout).not.toContain(scratch.token);
      expect(result.stderr).not.toContain(scratch.token);
    });

    it('handles a URL far longer than any real one', async () => {
      const result = await run({ pr_url: `https://github.com/o/r/pull/1?${oversized(20_000)}` }, 'failure');

      expect(result.stderr).not.toContain('UnhandledPromiseRejection');
      expectNotVerified(result);
    });

    it('publishes no outputs at all when it could not run the check', async () => {
      const result = await run({ user_ids: 'not-an-id' }, 'failure');

      expect(result.outputs).toEqual({});
      expect(result.exportedEnv).toEqual({});
    });
  });
});
