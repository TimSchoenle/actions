import { exec } from '@actions/exec';

import type { BotIdentity } from 'actions-util';

/**
 * The git operations this action needs, kept minimal so it can be faked in tests without spawning a
 * process.
 */
export interface GitConfigurator {
  /** Sets a repository-local git config value, e.g. `git config user.name "…"`. */
  setLocalConfig(key: string, value: string): Promise<void>;
}

/**
 * Binds {@link GitConfigurator} to the `git` executable in the workspace.
 *
 * The config is written repository-local (the default scope), not `--global`: the identity belongs
 * to the checkout the workflow is operating on, and a global write would leak into any later step
 * that shells out to git in the same job.
 */
export function createGitConfigurator(): GitConfigurator {
  return {
    async setLocalConfig(key: string, value: string): Promise<void> {
      await exec('git', ['config', key, value]);
    },
  };
}

/**
 * Writes the bot's name and email into the repository-local git config, so commits created by later
 * steps are attributed to the app bot.
 */
export async function configureGitIdentity(git: GitConfigurator, identity: BotIdentity): Promise<void> {
  await git.setLocalConfig('user.name', identity.name);
  await git.setLocalConfig('user.email', identity.email);
}
