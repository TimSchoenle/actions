/**
 * Decides whether a pull request gets a CodeRabbit review command, and posts it.
 *
 * CodeRabbit stopped reviewing public repositories with fewer than 10 stars on its own. It still
 * answers `@coderabbitai review`, but only from a user account: the same comment from
 * `github-actions[bot]` or a GitHub App is ignored without a reply. The token check therefore runs
 * before anything else, so a misconfigured token fails every run instead of posting comments that
 * look like they worked.
 *
 * @packageDocumentation
 */
import { quoteForLog } from 'actions-util';

import type { PostedComment, PullRequestInfo, TriggerApi } from './github-api.js';
import type { PullRequestCoordinates } from 'actions-util';

/** The CodeRabbit commands this action may post. */
export const COMMANDS = ['review', 'full review'] as const;

export type Command = (typeof COMMANDS)[number];

/** Why a pull request was not given a review command. */
export type SkipReason = 'closed' | 'draft' | 'fork' | 'bot-author' | 'skipped-author';

export interface TriggerOptions {
  pullRequest: PullRequestCoordinates;
  command: Command;
  skipDrafts: boolean;
  skipBots: boolean;
  /** Lower-cased logins. */
  skipAuthors: ReadonlySet<string>;
  rejectForks: boolean;
}

export type TriggerOutcome =
  | { triggered: true; comment: PostedComment; actor: string }
  | { triggered: false; skipReason: SkipReason };

/**
 * Checks `value` against the commands CodeRabbit accepts here.
 *
 * @throws if `value` is not one of {@link COMMANDS}.
 */
export function parseCommand(value: string): Command {
  const command = COMMANDS.find((candidate) => candidate === value.trim());

  if (command === undefined) {
    throw new Error(`Invalid command ${quoteForLog(value)}. Expected one of: ${COMMANDS.join(', ')}.`);
  }

  return command;
}

/** Splits a comma- or newline-separated list of logins into a lower-cased set, dropping blanks. */
export function parseLogins(value: string): Set<string> {
  return new Set(
    value
      .split(/[,\n]/)
      .map((login) => login.trim().toLowerCase())
      .filter((login) => login !== ''),
  );
}

/** The first rule that excludes `pullRequest`, in the order the action reports them, or `undefined`. */
export function skipReasonFor(pullRequest: PullRequestInfo, options: TriggerOptions): SkipReason | undefined {
  if (pullRequest.state !== 'open') {
    return 'closed';
  }
  if (options.skipDrafts && pullRequest.draft) {
    return 'draft';
  }
  if (
    options.rejectForks &&
    pullRequest.headRepoFullName.toLowerCase() !== pullRequest.baseRepoFullName.toLowerCase()
  ) {
    return 'fork';
  }
  if (options.skipBots && pullRequest.authorType === 'Bot') {
    return 'bot-author';
  }
  if (options.skipAuthors.has(pullRequest.authorLogin.toLowerCase())) {
    return 'skipped-author';
  }

  return undefined;
}

/**
 * Posts `@coderabbitai <command>` on the pull request unless a skip rule applies.
 *
 * @throws if the token does not authenticate as a user account, before the pull request is read.
 */
export async function triggerReview(api: TriggerApi, options: TriggerOptions): Promise<TriggerOutcome> {
  const identity = await api.getTokenIdentity();

  if (identity?.type !== 'User') {
    const actor =
      identity === undefined
        ? 'a GitHub App or GITHUB_TOKEN'
        : `the ${identity.type} account ${quoteForLog(identity.login)}`;

    throw new Error(
      `The token authenticates as ${actor}, and CodeRabbit ignores commands that do not come from a user account. ` +
        'Pass a personal access token of a user with Pull requests: write on this repository.',
    );
  }

  const pullRequest = await api.getPullRequest(options.pullRequest);
  const skipReason = skipReasonFor(pullRequest, options);

  if (skipReason !== undefined) {
    return { skipReason, triggered: false };
  }

  const comment = await api.postComment(options.pullRequest, `@coderabbitai ${options.command}`);

  return { actor: identity.login, comment, triggered: true };
}
