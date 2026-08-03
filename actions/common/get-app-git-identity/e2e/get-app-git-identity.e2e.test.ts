import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';

/**
 * End-to-end cases for `actions/common/get-app-git-identity`, replacing the single job of
 * `verify-action-common-get-app-git-identity.yaml`.
 *
 * `github-actions` is used as the subject because it is a bot that exists on every installation and
 * whose numeric id is stable. Its inputs are hyphenated, so these cases also cover the `INPUT_APP-SLUG`
 * spelling — the one place `@actions/core`'s name mapping is easy to get wrong.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const APP_SLUG = 'github-actions';
const BOT_ID = '41898282';

describe('get-app-git-identity', () => {
  const scratch = ScratchRepo.fromEnvironment('get-app-git-identity');

  it('resolves the bot name, id and no-reply email of an app', async () => {
    const result = await runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { 'app-slug': APP_SLUG, token: scratch.token },
      secrets: [scratch.token],
    });

    expect(result.outputs).toEqual({
      'bot-name': `${APP_SLUG}[bot]`,
      'bot-id': BOT_ID,
      'bot-email': `${BOT_ID}+${APP_SLUG}[bot]@users.noreply.github.com`,
    });
  });

  // The shell version could not assert this: a failing step there ends the job.
  it('fails when the app slug does not resolve to a user', async () => {
    const slug = 'this-app-does-not-exist-e2e';

    const result = await runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { 'app-slug': slug, token: scratch.token },
      secrets: [scratch.token],
      expect: 'failure',
    });

    expect(result.errors.join('\n')).toContain(slug);
    expect(result.outputs).toEqual({});
  });
});
