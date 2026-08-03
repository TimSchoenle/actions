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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * Hostile cases for `actions/maintenance/ensure-actions-are-executed`, run against a real repository.
 *
 * Unlike the suite beside it, these cases **create no check runs**, which is what lets them run on a
 * laptop: `POST /repos/{o}/{r}/check-runs` accepts only a GitHub App token, but *reading* checks and
 * validating inputs needs nothing special. Everything here is therefore about the two things that
 * decide whether this gate can be talked out of its answer.
 *
 * A matcher is a caller-supplied regular expression, evaluated against check-run names that come from
 * whatever workflow produced them — a pattern chosen badly and a name chosen deliberately is
 * catastrophic backtracking on a billed runner. And the gate's whole contract is "checks that started
 * must have succeeded", so no input may produce `failed_checks_count=0` by preventing the check from
 * happening at all.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('ensure-actions-are-executed under hostile input', () => {
  const scratch = ScratchRepo.fromEnvironment('ensure-actions-adv');

  let head: string;

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'any',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: {
        token: scratch.token,
        repository: scratch.repository,
        ref: head,
        checks: 'build',
        ...inputs,
      },
      secrets: [scratch.token],
      expect: expected,
    });
  }

  beforeAll(async () => {
    head = (await scratch.refSha(await scratch.defaultBranch())) as string;
  });

  afterAll(() => scratch.teardown());

  describe('matchers that must not run away', () => {
    it.each(REDOS_PATTERNS)(
      'bounds $name rather than backtracking on a runner',
      async ({ pattern }) => {
        const started = Date.now();

        const result = await run({ checks: `/${pattern}/`, match_mode: 'auto' });
        const elapsed = Date.now() - started;

        // `PATTERN_MATCH_TIMEOUT_MS` turns the hang into a failed step. Either outcome is fine; taking
        // minutes is not, because a gate that never returns never gates.
        expect(elapsed, 'a matcher must not burn a runner').toBeLessThan(60_000);
        expect(result.stderr).not.toContain('UnhandledPromiseRejection');
        expectNoInjection(result);
      },
      120_000,
    );

    // Written bare rather than slash-wrapped: in `regex` mode the whole value is the pattern, so
    // `/*/` is not an empty pattern between delimiters — it is the perfectly valid "slashes, then a
    // slash", and expecting it to be refused would be testing a delimiter this mode does not have.
    it.each([
      { name: 'an unterminated group', value: '^(unclosed' },
      { name: 'an inverted character range', value: '[z-a]' },
      { name: 'a lone quantifier', value: '*' },
      { name: 'an unterminated character class', value: '[abc' },
      { name: 'a dangling backslash', value: 'build\\' },
    ])('refuses $name as a matcher rather than matching nothing quietly', async ({ value }) => {
      const result = await run({ checks: value, match_mode: 'regex' }, 'failure');

      // A pattern that fails to compile must not degrade into "matched nothing", which this action
      // treats as "the check never started" — the one outcome it tolerates.
      expectCleanRejection(result);
      expect(result.outputs).toEqual({});
      expectNoInjection(result);
    });

    it.each([
      { name: 'an empty list', value: '' },
      { name: 'only separators', value: ',,,' },
      { name: 'only whitespace', value: '   ' },
      { name: 'only newlines', value: '\n\n' },
    ])('refuses $name as the checks input', async ({ value }) => {
      const result = await run({ checks: value }, 'failure');

      expectCleanRejection(result);
      expectNoInjection(result);
    });

    it.each([
      { name: 'an unknown mode', value: 'fuzzy' },
      { name: 'a mode with a typo', value: 'exect' },
      { name: 'an empty mode', value: '' },
      { name: 'a mode that is a regex', value: '/regex/' },
    ])('refuses $name as match_mode', async ({ value }) => {
      const result = await run({ match_mode: value }, 'failure');

      expectCleanRejection(result, /match_mode/);
      expect(result.outputs).toEqual({});
    });

    it('accepts each declared mode, so the gate is not simply always closed', async () => {
      for (const mode of ['auto', 'exact', 'regex']) {
        const result = await run({ checks: 'build', match_mode: mode });

        expect(result.errors.join('\n'), `mode '${mode}' must be accepted`).not.toMatch(/Invalid match_mode/);
      }
    });
  });

  describe('the ref it inspects', () => {
    it('refuses an empty ref rather than inspecting the default branch', async () => {
      const result = await run({ ref: '' }, 'failure');

      // The input defaults to a workflow expression; an empty value means it did not resolve, and
      // quietly falling back to some other ref would verify checks for the wrong commit.
      expectCleanRejection(result, /ref/);
      expect(result.outputs).toEqual({});
    });

    it.each([
      { name: 'a ref that does not exist', value: '0000000000000000000000000000000000000000' },
      { name: 'a traversal', value: 'refs/heads/../../main' },
      { name: 'an argument-looking ref', value: '--force' },
      { name: 'a ref carrying workflow commands', value: commandInjectionPayload('main') },
    ])('never reports success by failing to look at $name', async ({ value }) => {
      const result = await run({ ref: value }, 'any');

      // Either it failed, or it found no checks — which this action reports as a notice, never as a
      // silent pass with a fabricated count.
      if (result.exitCode === 0) {
        expect(result.outputs['matched_checks_count']).toBe('0');
      }

      expectNoInjection(result);
    });
  });

  describe('the answer it publishes', () => {
    it('publishes both counts as plain integers, or nothing at all', async () => {
      const result = await run({ checks: 'a-check-that-does-not-exist' }, 'any');

      if (result.exitCode === 0) {
        expect(result.outputs['matched_checks_count']).toMatch(/^\d+$/);
        expect(result.outputs['failed_checks_count']).toMatch(/^\d+$/);
      } else {
        expect(result.outputs).toEqual({});
      }
    });

    it.each(['yes', '1', 'on', 'off'])('refuses the ambiguous error_on_failure value %j', async (value) => {
      const result = await run({ error_on_failure: value }, 'failure');

      // A gate a typo turns into a warning is a gate that stops being one without anyone noticing.
      expectCleanRejection(result);
    });

    it.each([
      { name: 'no slash', value: 'justaname' },
      { name: 'too many segments', value: 'owner/repo/extra' },
      { name: 'a parent walk', value: 'owner/../other' },
      { name: 'a URL rather than a slug', value: 'https://github.com/owner/repo' },
    ])('refuses a repository slug with $name', async ({ value }) => {
      const result = await run({ repository: value }, 'failure');

      expect(result.outputs).toEqual({});
      expectNoInjection(result);
    });
  });

  describe('injection through the inputs', () => {
    it.each([
      { name: 'the checks list', input: 'checks' as const },
      { name: 'the ref', input: 'ref' as const },
      { name: 'the repository', input: 'repository' as const },
    ])('forges nothing through $name', async ({ input }) => {
      const result = await run({ [input]: commandInjectionPayload('build') }, 'any');

      expectNoInjection(result);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('forges nothing through $name ($risk) in a matcher', async ({ value }) => {
      const result = await run({ checks: `build${value}` }, 'any');

      expectNoInjection(result);
    });

    it('never echoes the token', async () => {
      const result = await run({ checks: commandInjectionPayload('build') }, 'any');

      expect(result.stdout).not.toContain(scratch.token);
      expect(result.stderr).not.toContain(scratch.token);
    });

    it('handles a checks list far longer than any workflow would declare', async () => {
      const result = await run(
        { checks: Array.from({ length: 500 }, (_, index) => `check-${index}`).join(',') },
        'any',
      );

      expect(result.stderr).not.toContain('UnhandledPromiseRejection');
      expectNoInjection(result);
    }, 120_000);

    it('handles a single matcher far longer than any check name', async () => {
      const result = await run({ checks: oversized(20_000) }, 'any');

      expect(result.stderr).not.toContain('UnhandledPromiseRejection');
      expectNoInjection(result);
    });
  });
});
