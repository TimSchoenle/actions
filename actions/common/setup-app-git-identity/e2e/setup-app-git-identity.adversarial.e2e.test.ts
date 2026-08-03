import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoInjection,
  INPUT_HOSTILE_CHARACTERS,
  oversized,
  runAction,
  ScratchRepo,
  TRAVERSAL_PATHS,
  Workspace,
} from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome } from 'actions-e2e';

/**
 * Hostile cases for `actions/common/setup-app-git-identity`, run against a real repository.
 *
 * This action writes into `.git/config`, which makes it the one action here whose output is *parsed
 * as configuration* rather than displayed. A git config value that contained a newline could open a
 * new section — `[core]\n  sshCommand = ...` turns an identity into command execution on the next
 * fetch — so the property under test is that nothing an input can carry reaches that file as
 * structure, and that a run which fails leaves no half-written identity behind.
 *
 * The only input that is not a credential is `app-slug`, and it is resolved through the API before
 * git is touched at all. That ordering is what these cases lean on.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const APP_SLUG = 'github-actions';

describe('setup-app-git-identity under hostile input', () => {
  const scratch = ScratchRepo.fromEnvironment('setup-app-git-identity-adv');

  let workspace: Workspace;

  afterEach(async () => {
    await workspace.dispose();
  });

  async function setup(slug: string, expected: ExpectedOutcome = 'failure'): Promise<ActionRunResult<ActionOutput>> {
    workspace = await Workspace.create();
    await workspace.initGit();

    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { 'app-slug': slug, token: scratch.token },
      workspace,
      secrets: [scratch.token],
      expect: expected,
    });
  }

  /**
   * The repository-local config minus what `git init` wrote itself.
   *
   * `git init` seeds `core.repositoryformatversion` and friends, so "the config is empty" is never
   * true and asserting it would only ever prove that git works. What matters is the keys this action
   * is responsible for, and any section that appeared beside them.
   */
  async function configuredKeys(): Promise<string[]> {
    const listed = await workspace.git(['config', '--local', '--list']).catch(() => '');

    return listed
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split('=')[0])
      .filter(
        (key) =>
          ![
            'core.repositoryformatversion',
            'core.filemode',
            'core.bare',
            'core.logallrefupdates',
            'core.symlinks',
            'core.ignorecase',
          ].includes(key),
      )
      .toSorted();
  }

  describe('app slugs that resolve to nothing', () => {
    it.each([
      { name: 'an empty slug', value: '' },
      { name: 'a slug that is only whitespace', value: '   ' },
      { name: 'a slug that does not exist', value: 'this-app-does-not-exist-4f3a9b' },
      { name: 'a slug with a slash', value: 'octocat/github-actions' },
      { name: 'a slug that is a query string', value: 'github-actions?per_page=100' },
      { name: 'a slug that is a fragment', value: 'github-actions#frag' },
    ])('refuses $name and writes no identity', async ({ value }) => {
      const result = await setup(value);

      expectCleanRejection(result);
      expect(result.outputs, 'a failed resolve must publish nothing').toEqual({});
      await expect(configuredKeys(), 'no identity may be written').resolves.toEqual([]);
      expectNoInjection(result);
    });

    // GitHub resolves `github-actions[bot][bot]`? No — the API is lenient about the suffix and hands
    // back the same bot, so this is accepted rather than refused. Pinned because "the slug already
    // has [bot] on it" is the shape a caller most plausibly gets wrong, and silently resolving to a
    // *different* account would be the thing to catch.
    it('resolves a slug that already carries the bot suffix to the same identity', async () => {
      const suffixed = await setup(`${APP_SLUG}[bot]`, 'any');

      if (suffixed.exitCode === 0) {
        expect(suffixed.outputs['bot-name']).toBe(`${APP_SLUG}[bot]`);
      } else {
        expectCleanRejection(suffixed);
      }

      expectNoInjection(suffixed);
    });

    it.each(TRAVERSAL_PATHS)('refuses $name as a slug, reaching no other user', async ({ value }) => {
      const result = await setup(value);

      expectCleanRejection(result);
      await expect(configuredKeys()).resolves.toEqual([]);
      expectNoInjection(result);
    });
  });

  describe('the git config it writes', () => {
    it('writes exactly two keys, and no section of its own', async () => {
      const result = await setup(APP_SLUG, 'success');

      await expect(configuredKeys()).resolves.toEqual(['user.email', 'user.name']);

      const config = await workspace.git(['config', '--local', '--list']);

      // The keys a section injection would be reaching for. None of them may appear at all.
      for (const dangerous of ['core.sshcommand', 'core.editor', 'core.pager', 'credential.helper', 'url.']) {
        expect(config, `git config gained '${dangerous}'`).not.toContain(dangerous);
      }
      expect(result.outputs['bot-name']).toBe(`${APP_SLUG}[bot]`);
    });

    it('writes no value spanning more than one line', async () => {
      await setup(APP_SLUG, 'success');

      // `git config --list` prints one `key=value` per line, so a value carrying a newline shows up
      // here as a line that is not a pair — which is exactly what a section injection looks like.
      const lines = (await workspace.git(['config', '--local', '--list'])).split('\n').filter((line) => line !== '');

      for (const line of lines) {
        expect(line, `'${line}' is not a key=value pair`).toMatch(/^[\w.-]+=/);
      }
    });

    it('leaves the global config alone even when the run fails', async () => {
      await setup('this-app-does-not-exist-4f3a9b');

      await expect(workspace.git(['config', '--global', '--list'])).resolves.toBe('');
    });

    it('fails without writing anything when there is no repository to write to', async () => {
      workspace = await Workspace.create();

      // No `initGit`: `git config --local` outside a repository must fail the step rather than fall
      // back to the global file, which would follow the runner into every later step of the job.
      const result = await runAction<ActionInput, ActionOutput>({
        actionDirectory: ACTION_DIRECTORY,
        inputs: { 'app-slug': APP_SLUG, token: scratch.token },
        workspace,
        secrets: [scratch.token],
        expect: 'failure',
      });

      expectCleanRejection(result);
      await expect(workspace.git(['config', '--global', '--list'])).resolves.toBe('');
    });
  });

  describe('injection through the inputs', () => {
    it('forges nothing through a slug full of workflow commands', async () => {
      const result = await setup(commandInjectionPayload('github-actions'));

      expectNoInjection(result);
    });

    // Two outcomes are legitimate here and which one you get depends on the character, not on this
    // action: `core.getInput` trims, and CR, LF and U+2028 are whitespace to `String.trim`, so those
    // slugs arrive as the plain one and resolve. The rest survive the trim and resolve to nothing.
    // What must hold either way is that no identity is invented from the hostile text.
    it.each(INPUT_HOSTILE_CHARACTERS)('forges nothing through $name ($risk) in the slug', async ({ value }) => {
      const result = await setup(`${APP_SLUG}${value}`, 'any');

      expectNoInjection(result);

      if (result.exitCode === 0) {
        expect(result.outputs['bot-name'], 'only the trimmed slug may ever resolve').toBe(`${APP_SLUG}[bot]`);
        await expect(configuredKeys()).resolves.toEqual(['user.email', 'user.name']);
      } else {
        await expect(configuredKeys()).resolves.toEqual([]);
      }
    });

    it('never echoes the token', async () => {
      const result = await setup(APP_SLUG, 'success');

      expect(result.stdout).not.toContain(scratch.token);
      expect(result.stderr).not.toContain(scratch.token);
    });

    it('handles a slug far longer than any app name', async () => {
      const result = await setup(oversized(5000));

      expectCleanRejection(result);
      expectNoInjection(result);
    });
  });
});
