import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectNoInjection,
  INPUT_HOSTILE_CHARACTERS,
  oversized,
  runAction,
  ScratchRepo,
} from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * Hostile cases for `actions/common/delete-branch`, run against a real repository.
 *
 * This action *destroys* a ref, with a token that can destroy any of them, so the property under
 * test is containment: a `branch_name` must reach the ref it names and no other. Everything a
 * traversal could plausibly exploit — the `heads/` prefix the API path is built from, the separators
 * git allows in a ref, a name that resolves somewhere else — is tried here.
 *
 * **No case names a branch that matters.** The stand-in for "a ref the caller did not ask to touch"
 * is a bystander branch created inside this suite's own namespace: an assertion that proves a
 * traversal reached `main` would have to delete `main` to prove it.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('delete-branch under hostile input', () => {
  const scratch = ScratchRepo.fromEnvironment('delete-branch-adv');

  /** The ref no case is allowed to disturb, recreated before each attempt to reach it. */
  let bystander: string;
  let bystanderSha: string;

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

  /** Recreates the bystander at a known commit, so each traversal attempt starts from the same state. */
  async function restoreBystander(): Promise<void> {
    if ((await scratch.refSha(bystander)) === undefined) {
      await scratch.createBranch(bystander, bystanderSha);
    }
  }

  beforeAll(async () => {
    bystander = scratch.branch('bystander');
    bystanderSha = await scratch.createBranch(bystander);
  });

  afterAll(() => scratch.teardown());

  describe('containment', () => {
    // Each of these resolves to the bystander if — and only if — the ref path is assembled by string
    // concatenation without the API rejecting the result. The action must delete nothing.
    it.each([
      { name: 'a parent walk out of the namespace', suffix: 'sacrifice/../bystander' },
      { name: 'a ref path that re-enters heads/', suffix: 'sacrifice/../../heads/bystander' },
      { name: 'a doubled separator', suffix: 'sacrifice//../bystander' },
      { name: 'a backslash separator', suffix: 'sacrifice\\..\\bystander' },
    ])('does not reach a bystander branch through $name', async ({ suffix }) => {
      await restoreBystander();

      const namespaced = `${bystander.slice(0, bystander.lastIndexOf('/'))}/${suffix}`;
      const result = await run({ branch_name: namespaced }, 'any');

      // Whatever it reports, the only thing that matters is the ref that is still there.
      await expect(scratch.refSha(bystander), `'${namespaced}' must not have reached '${bystander}'`).resolves.toBe(
        bystanderSha,
      );
      expectNoInjection(result);
    });

    it.each([
      { name: 'a fully qualified ref', prefix: 'refs/heads/' },
      { name: 'a heads-prefixed ref', prefix: 'heads/' },
    ])('does not delete a branch addressed as $name', async ({ prefix }) => {
      await restoreBystander();

      const result = await run({ branch_name: `${prefix}${bystander}` }, 'any');

      // `branch_name` is a branch name, not a ref. Accepting the qualified form would mean two
      // spellings of the same delete, and the qualified one can address tags and remotes as well.
      await expect(scratch.refSha(bystander)).resolves.toBe(bystanderSha);
      expectNoInjection(result);
    });

    it('deletes exactly the branch it was given, and reports it', async () => {
      const target = scratch.branch('deletable');

      await scratch.createBranch(target);
      await restoreBystander();

      const result = await run({ branch_name: target });

      expect(result.outputs).toEqual({ deleted: 'true' });
      await expect(scratch.refSha(target)).resolves.toBeUndefined();
      await expect(scratch.refSha(bystander), 'the neighbour must survive').resolves.toBe(bystanderSha);
    });
  });

  describe('names git itself refuses', () => {
    // git's own ref grammar rejects all of these. The action must surface that as a decision, not as
    // a crash and not as a silent success — `deleted` is what a caller branches on.
    it.each([
      { name: 'a trailing .lock', value: 'test/adv/branch.lock' },
      { name: 'a component starting with a dot', value: 'test/adv/.hidden' },
      { name: 'a double dot', value: 'test/adv/a..b' },
      { name: 'a caret', value: 'test/adv/a^b' },
      { name: 'a tilde', value: 'test/adv/a~b' },
      { name: 'a colon', value: 'test/adv/a:b' },
      { name: 'a question mark', value: 'test/adv/a?b' },
      { name: 'an asterisk', value: 'test/adv/a*b' },
      { name: 'a bracket', value: 'test/adv/a[b' },
      { name: 'a space', value: 'test/adv/a b' },
      { name: 'a leading slash', value: '/test/adv/leading' },
      { name: 'a trailing slash', value: 'test/adv/trailing/' },
      { name: 'the literal HEAD', value: 'HEAD' },
      { name: 'an at-brace', value: 'test/adv/a@{b' },
      { name: 'an argument-looking name', value: '--force' },
    ])('decides rather than crashes on $name', async ({ value }) => {
      const result = await run({ branch_name: value }, 'any');

      expect(result.stderr, 'nothing may escape as an unhandled rejection').not.toContain('UnhandledPromiseRejection');
      expect(['true', 'false']).toContain(result.outputs['deleted'] ?? 'false');
      expectNoInjection(result);
    });

    it('reports an absent branch as not deleted rather than failing the workflow', async () => {
      const absent = `${scratch.branch('never-created')}-absent`;

      const result = await run({ branch_name: absent });

      // This action cleans up after work that already succeeded, so a branch that is already gone is
      // the normal case and must not fail the step. `deleted` is how a caller learns the difference.
      expect(result.outputs).toEqual({ deleted: 'false' });
    });
  });

  describe('injection through the inputs', () => {
    it('forges nothing through a branch name full of workflow commands', async () => {
      const result = await run({ branch_name: commandInjectionPayload('test/adv/forged') }, 'any');

      expectNoInjection(result);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('forges nothing through $name ($risk) in a branch name', async ({ value }) => {
      const result = await run({ branch_name: `test/adv/${value}x` }, 'any');

      expectNoInjection(result);
    });

    it('forges nothing through a hostile repository slug, and deletes nothing', async () => {
      await restoreBystander();

      const result = await run(
        { repository: commandInjectionPayload('owner/repo'), branch_name: bystander },
        'failure',
      );

      expect(result.errors.join('\n')).not.toBe('');
      await expect(scratch.refSha(bystander)).resolves.toBe(bystanderSha);
      expectNoInjection(result);
    });

    it.each([
      { name: 'no slash', value: 'justaname' },
      { name: 'too many segments', value: 'owner/repo/extra' },
      { name: 'a parent walk', value: 'owner/../other' },
      { name: 'an empty owner', value: '/repo' },
      { name: 'an empty repository', value: 'owner/' },
      { name: 'a URL rather than a slug', value: 'https://github.com/owner/repo' },
    ])('refuses a repository slug with $name', async ({ value }) => {
      const result = await run({ repository: value, branch_name: 'test/adv/whatever' }, 'failure');

      expect(result.outputs).toEqual({});
      expectNoInjection(result);
    });

    it('never echoes the token, whatever it is asked to do', async () => {
      const result = await run({ branch_name: commandInjectionPayload('test/adv/leak') }, 'any');

      expect(result.stdout, 'the token must never reach the log').not.toContain(scratch.token);
      expect(result.stderr).not.toContain(scratch.token);
    });

    it('handles a branch name far longer than any ref git would accept', async () => {
      const result = await run({ branch_name: `test/adv/${oversized(5000)}` }, 'any');

      expect(result.stderr).not.toContain('UnhandledPromiseRejection');
      expectNoInjection(result);
    });
  });
});
