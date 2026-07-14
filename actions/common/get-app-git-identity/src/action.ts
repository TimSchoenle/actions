import * as core from '@actions/core';

import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { createAppUserApi } from './github-api.js';
import { resolveBotIdentity } from './identity.js';

import type { AppUserApi } from './identity.js';

/**
 * Reads the action inputs, resolves the bot's git identity and publishes the `bot-name`,
 * `bot-email` and `bot-id` outputs.
 *
 * `bot-id` is published as a string because that is all an action output can carry; consumers that
 * need the number parse it back.
 *
 * @param api injection seam for tests; defaults to the GitHub REST API bound to the `token` input.
 */
export async function run(api?: AppUserApi): Promise<void> {
  try {
    const token = getInput(ActionInput.token, { required: true });
    const appSlug = getInput(ActionInput['app-slug'], { required: true });

    const identity = await resolveBotIdentity(api ?? createAppUserApi(token), appSlug);

    core.info(`Resolved git identity: ${identity.name} <${identity.email}>`);

    setOutput(ActionOutput['bot-name'], identity.name);
    setOutput(ActionOutput['bot-email'], identity.email);
    setOutput(ActionOutput['bot-id'], String(identity.id));
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}
