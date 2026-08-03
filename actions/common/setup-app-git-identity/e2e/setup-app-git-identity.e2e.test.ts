import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo, Workspace } from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';

/**
 * End-to-end cases for `actions/common/setup-app-git-identity`, replacing the single job of
 * `verify-action-common-setup-app-git-identity.yaml`.
 *
 * This action shells out to `git config`, so its cases run against a real repository created for
 * each one. The workspace is disposable, which lets the "does not leak globally" case below be
 * asserted at all — in the shell version the repository was the runner's own checkout, and writing a
 * global config there would have been invisible.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const APP_SLUG = 'github-actions';
const BOT_ID = '41898282';
const BOT_NAME = `${APP_SLUG}[bot]`;
const BOT_EMAIL = `${BOT_ID}+${BOT_NAME}@users.noreply.github.com`;

describe('setup-app-git-identity', () => {
  const scratch = ScratchRepo.fromEnvironment('setup-app-git-identity');

  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.dispose();
    workspace = undefined;
  });

  it('writes the bot identity into the repository-local git config', async () => {
    workspace = await Workspace.create();
    await workspace.initGit();

    const result = await runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { 'app-slug': APP_SLUG, token: scratch.token },
      workspace,
      secrets: [scratch.token],
    });

    expect(result.outputs).toEqual({ 'bot-name': BOT_NAME, 'bot-id': BOT_ID, 'bot-email': BOT_EMAIL });
    await expect(workspace.gitConfig('user.name')).resolves.toBe(BOT_NAME);
    await expect(workspace.gitConfig('user.email')).resolves.toBe(BOT_EMAIL);
  });

  // The identity belongs to the checkout being operated on. A `--global` write would follow the
  // runner into every later step of the job, which is the bug this asserts against.
  it('leaves the global git config alone', async () => {
    workspace = await Workspace.create();
    await workspace.initGit();

    await runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { 'app-slug': APP_SLUG, token: scratch.token },
      workspace,
      secrets: [scratch.token],
    });

    const global = await workspace.git(['config', '--global', '--list']);

    expect(global).toBe('');
  });
});
