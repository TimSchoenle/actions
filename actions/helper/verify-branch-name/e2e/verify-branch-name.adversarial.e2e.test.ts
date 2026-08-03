import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectNoInjection,
  INPUT_HOSTILE_CHARACTERS,
  oversized,
  REDOS_PATTERNS,
  runAction,
} from 'actions-e2e';
import { describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * Hostile cases for `actions/helper/verify-branch-name`.
 *
 * This is a *gate*, and the only one of the set whose every input comes straight out of a
 * `pull_request` payload an outside contributor controls. Two failure modes matter, and they are not
 * symmetric: letting a branch through that should have been rejected defeats the gate, and burning a
 * runner forever on a pattern that backtracks costs money without ever reporting anything. Both are
 * exercised here against the shipped bundle, because the fork check is what stands between a fork's
 * branch and a workflow that auto-approves it.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const BASE_REPO = 'TimSchoenle/actions';

function verify(
  inputs: ProvidedInputs<ActionInput>,
  expected: ExpectedOutcome = 'success',
): ReturnType<typeof runAction<ActionInput, ActionOutput>> {
  return runAction<ActionInput, ActionOutput>({
    actionDirectory: ACTION_DIRECTORY,
    inputs: {
      branch_pattern: '^release-please--branches--main$',
      head_ref: 'release-please--branches--main',
      head_repo_full_name: BASE_REPO,
      base_repo_full_name: BASE_REPO,
      reject_forks: 'true',
      error_on_failure: 'false',
      ...inputs,
    },
    expect: expected,
  });
}

describe('verify-branch-name under hostile input', () => {
  describe('the fork check', () => {
    it.each([
      { name: 'a differently cased owner', head: 'timschoenle/actions' },
      { name: 'a differently cased repository', head: 'TimSchoenle/Actions' },
      { name: 'a trailing slash', head: `${BASE_REPO}/` },
      { name: 'a leading slash', head: `/${BASE_REPO}` },
      { name: 'a lookalike owner', head: 'TimSchoenle-/actions' },
      { name: 'a nested path that starts with the base', head: `${BASE_REPO}/nested` },
      { name: 'a zero-width character inside the owner', head: `TimSchoen​le/actions` },
      { name: 'a homoglyph owner', head: 'TimSchoenlе/actions' },
      { name: 'the base name as a suffix', head: `fork/${BASE_REPO}` },
    ])('treats $name as a fork rather than as the base repository', async ({ head }) => {
      const result = await verify({ head_repo_full_name: head });

      expect(result.outputs['fork_verified'], `'${head}' must not pass as the base repository`).toBe('false');
      expect(result.outputs['verified']).toBe('false');
    });

    // Not a bypass, and pinned so it is not mistaken for one later: `core.getInput` trims every
    // input before the action ever sees it, so surrounding whitespace cannot reach the comparison.
    it('sees a padded repository name already trimmed by the runner contract', async () => {
      const result = await verify({ head_repo_full_name: ` ${BASE_REPO} ` });

      expect(result.outputs['fork_verified']).toBe('true');
    });

    it('recognises the base repository itself, so the gate is not simply always closed', async () => {
      const result = await verify({});

      expect(result.outputs).toEqual({
        verified: 'true',
        branch_pattern_verified: 'true',
        fork_verified: 'true',
      });
    });

    it('still reports a fork as such when forks are allowed', async () => {
      const result = await verify({ head_repo_full_name: 'someone/fork', reject_forks: 'false' });

      expect(result.outputs['fork_verified']).toBe('true');
      expect(result.outputs['verified']).toBe('true');
    });

    it.each([
      { name: 'an empty head repository', inputs: { head_repo_full_name: '' } },
      { name: 'an empty base repository', inputs: { base_repo_full_name: '' } },
      { name: 'an empty head ref', inputs: { head_ref: '' } },
    ])('fails closed on $name rather than assuming it is not a fork', async ({ inputs }) => {
      // An unresolved `${{ }}` default arrives as an empty string, which means the workflow did not
      // run on a pull request at all. Reading that as "same repository" would open the gate.
      const result = await verify(inputs, 'failure');

      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('the pattern check', () => {
    // The `error_on_failure: false` path deliberately does *not* apply here: a pattern that could not
    // be evaluated is not a branch that failed the check, it is a check that did not happen, and the
    // step fails either way. `PATTERN_MATCH_TIMEOUT_MS` is what turns the hang into that failure.
    it.each(REDOS_PATTERNS)(
      'kills $name instead of backtracking on a billed runner',
      async ({ pattern, subject }) => {
        const started = Date.now();

        const result = await verify({ branch_pattern: pattern, head_ref: subject }, 'failure');
        const elapsed = Date.now() - started;

        expect(elapsed, 'a gate that never returns is a gate that never gates').toBeLessThan(30_000);
        expect(result.errors.join('\n'), 'the failure must say why').not.toBe('');
        expect(result.outputs['branch_pattern_verified'], 'an unevaluated pattern can never verify').not.toBe('true');
        expectNoInjection(result);
      },
      120_000,
    );

    it.each([
      { name: 'an unterminated group', pattern: '^(unclosed' },
      { name: 'an inverted character range', pattern: '[z-a]' },
      { name: 'a lone quantifier', pattern: '*' },
      { name: 'a lone repetition', pattern: '{1,2}' },
    ])('fails closed on $name rather than treating it as a match', async ({ pattern }) => {
      const result = await verify({ branch_pattern: pattern }, 'any');

      expect(result.outputs['branch_pattern_verified'], 'an unusable pattern can never verify').not.toBe('true');
    });

    it.each([
      { name: 'a pattern matching everything', pattern: '.*', ref: 'anything-at-all' },
      { name: 'an unanchored pattern', pattern: 'release-please', ref: 'evil-release-please-branch' },
    ])('applies $name exactly as written, without adding anchors of its own', async ({ pattern, ref }) => {
      // Documented rather than defended: the input is a POSIX extended regex, unanchored, and a
      // workflow that wants an anchor writes one. Pinning it here means a future change to add
      // implicit anchoring cannot happen silently.
      const result = await verify({ branch_pattern: pattern, head_ref: ref });

      expect(result.outputs['branch_pattern_verified']).toBe('true');
    });

    it('skips the check on an empty pattern, and says so', async () => {
      const result = await verify({ branch_pattern: '', head_ref: 'anything' });

      expect(result.outputs['branch_pattern_verified']).toBe('true');
      expect(result.stdout).toContain('Skipping pattern check');
    });

    it('handles a ref far longer than git would ever allow', async () => {
      const result = await verify({ branch_pattern: '^a+$', head_ref: oversized(100_000) });

      expect(result.outputs['branch_pattern_verified']).toBe('false');
    });
  });

  describe('workflow command injection', () => {
    // Every one of these three inputs is echoed to the log before anything is checked, and all three
    // come from the pull request payload of a fork-authored event.
    it.each([
      { name: 'the head ref', input: 'head_ref' as const },
      { name: 'the head repository', input: 'head_repo_full_name' as const },
      { name: 'the base repository', input: 'base_repo_full_name' as const },
      { name: 'the branch pattern', input: 'branch_pattern' as const },
    ])('forges nothing through $name', async ({ input }) => {
      const result = await verify({ [input]: commandInjectionPayload('feature/x') }, 'any');

      expectNoInjection(result);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('forges nothing through $name ($risk) in a ref', async ({ value }) => {
      const result = await verify({ head_ref: `feature/${value}x` }, 'any');

      expectNoInjection(result);
    });

    it('publishes exactly its three declared outputs, whatever it was given', async () => {
      const result = await verify(
        {
          head_ref: commandInjectionPayload('feature/x'),
          branch_pattern: '.*',
          head_repo_full_name: commandInjectionPayload('owner/repo'),
        },
        'any',
      );

      expect(Object.keys(result.outputs).sort()).toEqual(['branch_pattern_verified', 'fork_verified', 'verified']);
      expect(result.exportedEnv).toEqual({});
      expect(result.addedPath).toEqual([]);
    });
  });

  describe('error_on_failure', () => {
    it('fails the step on a rejected branch when asked to', async () => {
      const result = await verify({ head_ref: 'not-matching', error_on_failure: 'true' }, 'failure');

      expect(result.errors.join('\n')).toContain('Branch pattern check failed');
      expect(result.outputs['verified'], 'outputs are published even on a failed gate').toBe('false');
    });

    it.each(['TRUE', 'yes', '1', 'on', ''])('refuses the ambiguous boolean %j rather than guessing', async (value) => {
      // `core.getBooleanInput` accepts only `true`/`false` in either case. Anything else must fail —
      // a gate that reads an unrecognised value as "off" is a gate that a typo disables.
      const result = await verify({ error_on_failure: value }, 'any');

      if (value.toLowerCase() === 'true') {
        expect(result.exitCode).toBe(0);
      } else {
        expect(result.exitCode, `'${value}' must not silently mean false`).not.toBe(0);
      }
    });
  });
});
