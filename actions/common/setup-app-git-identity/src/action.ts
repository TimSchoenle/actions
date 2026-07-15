import * as core from '@actions/core';
import { resolveBotIdentity, runAction } from 'actions-util';
import { createAppUserApi } from 'actions-util/identity';

import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { configureGitIdentity, createGitConfigurator } from './git.js';

import type { GitConfigurator } from './git.js';
import type { AppUserApi } from 'actions-util';

/** Injection seams for tests; each defaults to the real GitHub REST API and the `git` executable. */
export interface RunDependencies {
  api?: AppUserApi;
  git?: GitConfigurator;
}

/**
 * Reads the action inputs, resolves the bot's git identity, writes it into the repository-local git
 * config and publishes the `bot-name`, `bot-email` and `bot-id` outputs.
 *
 * The identity is resolved before git is touched, so a wrong app slug or an unusable token fails the
 * step without leaving a half-configured repository behind.
 *
 * `bot-id` is published as a string because that is all an action output can carry; consumers that
 * need the number parse it back.
 */
export function run({ api, git }: RunDependencies = {}): Promise<void> {
  return runAction(async () => {
    const appSlug = getInput(ActionInput['app-slug'], { required: true });
    const token = getInput(ActionInput.token, { required: true });

    const identity = await resolveBotIdentity(api ?? createAppUserApi(token), appSlug);

    core.info(`Configuring git user as ${identity.name} <${identity.email}>...`);
    await configureGitIdentity(git ?? createGitConfigurator(), identity);

    setOutput(ActionOutput['bot-name'], identity.name);
    setOutput(ActionOutput['bot-email'], identity.email);
    setOutput(ActionOutput['bot-id'], String(identity.id));
  });
}
