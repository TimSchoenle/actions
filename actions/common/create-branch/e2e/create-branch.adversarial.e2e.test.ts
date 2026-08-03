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
 * Hostile cases for `actions/common/create-branch`, run against a real repository.
 *
 * The write-side counterpart to `delete-branch`'s containment suite, and the more dangerous half:
 * with `reset_branch` set this action performs a **force update**, so a `branch_name` that resolved
 * somewhere unintended would not merely create a stray ref, it would rewind an existing one and
 * discard whatever was on it.
 *
 * As in that suite, the ref that must survive is a bystander created inside this suite's own
 * namespace. Proving a traversal can reach a branch that matters would require damaging one.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('create-branch under hostile input', () => {
  const scratch = ScratchRepo.fromEnvironment('create-branch-adv');

  let defaultBranch: string;
  let defaultSha: string;

  /** A branch with a commit of its own, so a force-reset to the default head would be visible. */
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

  beforeAll(async () => {
    defaultBranch = await scratch.defaultBranch();
    defaultSha = (await scratch.refSha(defaultBranch)) as string;

    bystander = scratch.branch('bystander');
    await scratch.createBranch(bystander);
    // Moved off the default head deliberately: a reset that reached this branch would rewind it to
    // `defaultSha`, and only a branch that is *ahead* can show that.
    bystanderSha = await scratch.commitFile(bystander, `${bystander}/keep.txt`, 'keep', 'test: bystander commit');

    expect(bystanderSha).not.toBe(defaultSha);
  });

  afterAll(() => scratch.teardown());

  describe('containment of the ref it writes', () => {
    it.each([
      { name: 'a parent walk out of the namespace', suffix: 'sacrifice/../bystander' },
      { name: 'a ref path that re-enters heads/', suffix: 'sacrifice/../../heads/bystander' },
      { name: 'a backslash separator', suffix: 'sacrifice\\..\\bystander' },
    ])('does not force-reset a bystander through $name', async ({ suffix }) => {
      const namespaced = `${bystander.slice(0, bystander.lastIndexOf('/'))}/${suffix}`;

      const result = await run({ branch_name: namespaced, reset_branch: 'true' }, 'any');

      await expect(
        scratch.headOf(bystander, bystanderSha),
        `'${namespaced}' must not have rewound '${bystander}'`,
      ).resolves.toBe(bystanderSha);
      expectNoInjection(result);
    });

    it.each([
      { name: 'a fully qualified ref', prefix: 'refs/heads/' },
      { name: 'a heads-prefixed ref', prefix: 'heads/' },
    ])('does not treat $name as the branch it names', async ({ prefix }) => {
      // Reserved before the run: if the action turns out to create a literal `heads/<name>` ref,
      // nothing namespaced would ever clean it up.
      const result = await run({ branch_name: scratch.reserve(`${prefix}${bystander}`), reset_branch: 'true' }, 'any');

      await expect(scratch.headOf(bystander, bystanderSha)).resolves.toBe(bystanderSha);
      expectNoInjection(result);
    });

    it('resets exactly the branch it was given, leaving its neighbour alone', async () => {
      const target = scratch.branch('resettable');

      await scratch.createBranch(target);
      const ahead = await scratch.commitFile(target, `${target}/x.txt`, 'x', 'test: move target');

      expect(ahead).not.toBe(defaultSha);

      const result = await run({ branch_name: target, reset_branch: 'true' });

      expect(result.outputs).toEqual({
        branch: target,
        base_branch: defaultBranch,
        sha: defaultSha,
        created: 'true',
      });
      await expect(scratch.headOf(target, defaultSha)).resolves.toBe(defaultSha);
      await expect(scratch.headOf(bystander, bystanderSha), 'the neighbour must survive').resolves.toBe(bystanderSha);
    });
  });

  describe('the base it reads', () => {
    it.each([
      { name: 'a parent walk', value: 'sacrifice/../main' },
      { name: 'a fully qualified ref', value: 'refs/heads/main' },
      { name: 'a heads-prefixed ref', value: 'heads/main' },
      { name: 'a name git refuses', value: 'a..b' },
    ])('fails with the base named when base_branch is $name, creating nothing', async ({ value }) => {
      const branch = scratch.branch(`bad-base-${value.replaceAll(/\W/g, '')}`);

      const result = await run({ branch_name: branch, base_branch: value }, 'failure');

      expect(result.outputs).toEqual({});
      await expect(scratch.refSha(branch), 'a failed resolve must create nothing').resolves.toBeUndefined();
      expectNoInjection(result);
    });
  });

  describe('names git itself refuses', () => {
    it.each([
      { name: 'a trailing .lock', value: 'test/adv/branch.lock' },
      { name: 'a double dot', value: 'test/adv/a..b' },
      { name: 'a caret', value: 'test/adv/a^b' },
      { name: 'a tilde', value: 'test/adv/a~b' },
      { name: 'a colon', value: 'test/adv/a:b' },
      { name: 'a space', value: 'test/adv/a b' },
      { name: 'a leading slash', value: '/test/adv/leading' },
      { name: 'a trailing slash', value: 'test/adv/trailing/' },
      { name: 'an argument-looking name', value: '--force' },
      { name: 'an empty name', value: '' },
    ])('refuses $name rather than creating something else', async ({ value }) => {
      // Reserved before the run, not after: the case does not know whether git will accept the
      // name, and a ref discovered only by a later `gh api` call is a ref nothing deletes.
      const result = await run({ branch_name: scratch.reserve(value) }, 'any');

      expect(result.stderr).not.toContain('UnhandledPromiseRejection');

      // Either it refused, or — for a name git happens to accept — it created exactly that name.
      if (result.exitCode === 0) {
        expect(result.outputs['branch']).toBe(value);
      } else {
        expect(result.outputs).toEqual({});
      }

      expectNoInjection(result);
    });
  });

  describe('injection through the inputs', () => {
    it.each([
      { name: 'the branch name', input: 'branch_name' as const },
      { name: 'the base branch', input: 'base_branch' as const },
      { name: 'the repository', input: 'repository' as const },
    ])('forges nothing through $name', async ({ input }) => {
      const inputs: ProvidedInputs<ActionInput> = { branch_name: scratch.branch('forged') };

      const result = await run({ ...inputs, [input]: commandInjectionPayload('test/adv/forged') }, 'any');

      expectNoInjection(result);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('forges nothing through $name ($risk) in a branch name', async ({ value }) => {
      const result = await run({ branch_name: scratch.reserve(`test/adv/${value}x`) }, 'any');

      expectNoInjection(result);
    });

    it('never echoes the token', async () => {
      const result = await run({ branch_name: scratch.branch('leak') });

      expect(result.stdout).not.toContain(scratch.token);
      expect(result.stderr).not.toContain(scratch.token);
    });

    it('handles a branch name far longer than any ref git would accept', async () => {
      const name = `test/adv/${oversized(5000)}`;
      const result = await run({ branch_name: name }, 'any');

      // Reserved only if it was actually created. A name this long is not a ref GitHub will accept,
      // and registering one it rejects as malformed would fail teardown on a branch that never was.
      if (result.exitCode === 0) {
        scratch.reserve(name);
      }

      expect(result.stderr).not.toContain('UnhandledPromiseRejection');
      expectNoInjection(result);
    });

    it.each([
      { name: 'no slash', value: 'justaname' },
      { name: 'too many segments', value: 'owner/repo/extra' },
      { name: 'a parent walk', value: 'owner/../other' },
      { name: 'a URL rather than a slug', value: 'https://github.com/owner/repo' },
    ])('refuses a repository slug with $name', async ({ value }) => {
      const result = await run({ repository: value, branch_name: scratch.reserve('test/adv/whatever') }, 'failure');

      expect(result.outputs).toEqual({});
      expectNoInjection(result);
    });
  });
});
