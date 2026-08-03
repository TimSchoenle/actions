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
 * Hostile cases for `actions/helper/resolve-base-branch`, run against a real repository.
 *
 * The sharp edge here is `silent_fail`. It exists so that a caller can ask "is there a base branch?"
 * without failing the workflow when there is not — but the moment it silences anything *other* than
 * a missing branch, it turns an unusable token or a network failure into an empty `base_branch`, and
 * every caller downstream reads that as "no branch, create one". These cases hold the line between
 * the two.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('resolve-base-branch under hostile input', () => {
  const scratch = ScratchRepo.fromEnvironment('resolve-base-branch-adv');

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'any',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, repository: scratch.repository, ...inputs },
      secrets: [scratch.token],
      expect: expected,
    });
  }

  afterAll(() => scratch.teardown());

  describe('what silent_fail may and may not silence', () => {
    it('silences a branch that does not exist, and says so in the output', async () => {
      const result = await run({ branch_name: 'test/adv/definitely-not-a-branch', silent_fail: 'true' }, 'success');

      expect(result.outputs).toEqual({ base_branch: '' });
      expect(result.warnings.join('\n')).toContain('silent_fail');
    });

    // The case that matters. An unusable token is not a missing branch, and reporting it as one hands
    // the caller an empty base branch it will happily branch from.
    it.each([
      { name: 'an unusable token', inputs: { token: 'ghp_000000000000000000000000000000000000' } },
      { name: 'an empty token', inputs: { token: '' } },
      { name: 'a repository that does not exist', inputs: { repository: `${scratch.owner}/not-a-real-repo-4f3a9b` } },
      { name: 'a malformed repository', inputs: { repository: 'not-a-slug' } },
    ])('does not silence $name, even with silent_fail set', async ({ inputs }) => {
      const result = await run({ ...inputs, branch_name: 'test/adv/whatever', silent_fail: 'true' }, 'failure');

      expectCleanRejection(result);
      expect(result.outputs['base_branch'], 'an error must never surface as an empty base branch').toBeUndefined();
      expectNoInjection(result);
    });

    it('fails on a missing branch when silent_fail is off', async () => {
      const result = await run({ branch_name: 'test/adv/definitely-not-a-branch', silent_fail: 'false' }, 'failure');

      expectCleanRejection(result, /does not exist/);
      expect(result.outputs).toEqual({});
    });
  });

  describe('the branch it is asked to resolve', () => {
    it.each([
      { name: 'a parent walk', value: 'test/adv/../../main' },
      { name: 'a fully qualified ref', value: 'refs/heads/main' },
      { name: 'a heads-prefixed ref', value: 'heads/main' },
      { name: 'a name git refuses', value: 'test/adv/a..b' },
      { name: 'an argument-looking name', value: '--force' },
      { name: 'the literal HEAD', value: 'HEAD' },
    ])('reports $name as absent rather than resolving it to something else', async ({ value }) => {
      const result = await run({ branch_name: value, silent_fail: 'true' }, 'any');

      // Whichever way it goes, it must not claim a branch by a name it was not given.
      expect(['', undefined, value]).toContain(result.outputs['base_branch']);
      expectNoInjection(result);
    });

    it('resolves the default branch when no branch is requested', async () => {
      const defaultBranch = await scratch.defaultBranch();

      const result = await run({ branch_name: '' }, 'success');

      expect(result.outputs).toEqual({ base_branch: defaultBranch });
    });

    it('never invents a branch when the existence check is disabled', async () => {
      const requested = 'test/adv/unchecked-and-absent';

      const result = await run({ branch_name: requested, check_if_exist: 'false' }, 'success');

      // With the check off the action is a pass-through, which is exactly why it must echo the input
      // and not a normalised or defaulted form of it.
      expect(result.outputs).toEqual({ base_branch: requested });
    });
  });

  describe('injection through the inputs', () => {
    it.each([
      { name: 'the branch name', input: 'branch_name' as const },
      { name: 'the repository', input: 'repository' as const },
    ])('forges nothing through $name', async ({ input }) => {
      const result = await run({ [input]: commandInjectionPayload('test/adv/forged') }, 'any');

      expectNoInjection(result);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('forges nothing through $name ($risk) in a branch name', async ({ value }) => {
      const result = await run({ branch_name: `test/adv/${value}x`, silent_fail: 'true' }, 'any');

      expectNoInjection(result);
    });

    it('never echoes the token', async () => {
      const result = await run({ branch_name: commandInjectionPayload('test/adv/leak'), silent_fail: 'true' }, 'any');

      expect(result.stdout).not.toContain(scratch.token);
      expect(result.stderr).not.toContain(scratch.token);
    });

    it('handles a branch name far longer than any ref git would accept', async () => {
      const result = await run({ branch_name: `test/adv/${oversized(5000)}`, silent_fail: 'true' }, 'any');

      expect(result.stderr).not.toContain('UnhandledPromiseRejection');
      expectNoInjection(result);
    });

    // `TRUE` is deliberately absent: `core.getBooleanInput` accepts true/True/TRUE, so it is a valid
    // spelling of the flag rather than an ambiguous one.
    it.each(['yes', '1', 'on', 'y'])('refuses the ambiguous silent_fail value %j', async (value) => {
      const result = await run({ branch_name: 'test/adv/absent', silent_fail: value }, 'failure');

      // A flag a typo silently disables is a flag that silently changes what an error looks like.
      expectCleanRejection(result);
    });
  });
});
