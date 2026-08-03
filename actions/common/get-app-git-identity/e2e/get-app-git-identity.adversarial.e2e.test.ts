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
} from 'actions-e2e';
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome } from 'actions-e2e';

/**
 * Hostile cases for `actions/common/get-app-git-identity`, run against a real repository.
 *
 * The identity this resolves is what later steps commit *as*, and other actions match commit authors
 * against the id it publishes. So the failure that matters is resolving to the wrong account and
 * saying nothing about it: a slug that reaches a different user turns author verification into a
 * check that passes for somebody else.
 *
 * `app-slug` is the only non-credential input, and it is interpolated into an API path — which is why
 * every shape that could steer that path is tried here.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const APP_SLUG = 'github-actions';
const BOT_ID = '41898282';

describe('get-app-git-identity under hostile input', () => {
  const scratch = ScratchRepo.fromEnvironment('get-app-git-identity-adv');

  function run(slug: string, expected: ExpectedOutcome = 'failure'): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { 'app-slug': slug, token: scratch.token },
      secrets: [scratch.token],
      expect: expected,
    });
  }

  afterAll(() => scratch.teardown());

  describe('slugs that must reach no account', () => {
    it.each([
      { name: 'an empty slug', value: '' },
      { name: 'whitespace only', value: '   ' },
      { name: 'a slug that does not exist', value: 'this-app-does-not-exist-4f3a9b' },
      { name: 'a slug with a slash', value: 'octocat/github-actions' },
      { name: 'a slug that is a query string', value: 'github-actions?per_page=100' },
      { name: 'a slug that is a fragment', value: 'github-actions#frag' },
      { name: 'a slug that closes the bot suffix early', value: 'github-actions]' },
      { name: 'a slug naming a real user', value: 'octocat' },
    ])('refuses $name', async ({ value }) => {
      const result = await run(value);

      expectCleanRejection(result);
      expect(result.outputs, 'a failed resolve must publish nothing').toEqual({});
      expectNoInjection(result);
    });

    // The interesting one: the slug is interpolated into `GET /users/{slug}[bot]`, so a path that
    // walks out of `/users/` would reach a different endpoint entirely.
    it.each(TRAVERSAL_PATHS)('refuses $name, reaching no other endpoint', async ({ value }) => {
      const result = await run(value);

      expectCleanRejection(result);
      expect(result.outputs).toEqual({});
      expectNoInjection(result);
    });
  });

  describe('the identity it publishes', () => {
    it('resolves the app it was named, and derives the email from that account', async () => {
      const result = await run(APP_SLUG, 'success');

      // Asserted as one object: an output that appears, disappears or drifts fails the case, and the
      // email must be derived from the id it actually resolved rather than from the slug it was given.
      expect(result.outputs).toEqual({
        'bot-name': `${APP_SLUG}[bot]`,
        'bot-id': BOT_ID,
        'bot-email': `${BOT_ID}+${APP_SLUG}[bot]@users.noreply.github.com`,
      });
    });

    it('publishes an id that is a plain positive integer', async () => {
      const result = await run(APP_SLUG, 'success');

      expect(result.outputs['bot-id']).toMatch(/^[1-9]\d*$/);
    });

    it('exports nothing to the environment of later steps', async () => {
      const result = await run(APP_SLUG, 'success');

      expect(result.exportedEnv).toEqual({});
      expect(result.addedPath).toEqual([]);
    });
  });

  describe('injection through the inputs', () => {
    it('forges nothing through a slug full of workflow commands', async () => {
      const result = await run(commandInjectionPayload(APP_SLUG));

      expectNoInjection(result);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('forges nothing through $name ($risk) in the slug', async ({ value }) => {
      const result = await run(`${APP_SLUG}${value}`, 'any');

      expectNoInjection(result);

      // CR, LF and U+2028 are whitespace to `String.trim`, which `core.getInput` applies, so those
      // arrive as the plain slug and resolve. Anything that survives the trim must resolve to nothing.
      if (result.exitCode === 0) {
        expect(result.outputs['bot-name']).toBe(`${APP_SLUG}[bot]`);
      } else {
        expect(result.outputs).toEqual({});
      }
    });

    it('never echoes the token', async () => {
      const result = await run(APP_SLUG, 'success');

      expect(result.stdout).not.toContain(scratch.token);
      expect(result.stderr).not.toContain(scratch.token);
    });

    it('fails cleanly on an unusable token rather than publishing an identity', async () => {
      const result = await runAction<ActionInput, ActionOutput>({
        actionDirectory: ACTION_DIRECTORY,
        inputs: { 'app-slug': APP_SLUG, token: 'ghp_000000000000000000000000000000000000' },
        expect: 'failure',
      });

      expectCleanRejection(result);
      expect(result.outputs).toEqual({});
    });

    it('handles a slug far longer than any app name', async () => {
      const result = await run(oversized(5000));

      expectCleanRejection(result);
      expectNoInjection(result);
    });
  });
});
