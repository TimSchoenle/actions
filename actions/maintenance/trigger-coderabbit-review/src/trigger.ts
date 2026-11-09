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
import { errorMessage, quoteForLog } from 'actions-util';

import { commandBody, duplicateReason, outdatedComments } from './activity.js';

import type { DuplicateReason, ReviewActivity } from './activity.js';
import type { PostedComment, PullRequestInfo, TriggerApi } from './github-api.js';
import type { PullRequestCoordinates } from 'actions-util';

/** The CodeRabbit commands this action may post. */
export const COMMANDS = ['review', 'full review'] as const;

export type Command = (typeof COMMANDS)[number];

/** Why a pull request was not given a review command. */
export type SkipReason =
  | 'closed'
  | 'other-base'
  | 'outdated'
  | 'draft'
  | 'fork'
  | 'bot-author'
  | 'skipped-author'
  | DuplicateReason;

export interface TriggerOptions {
  pullRequest: PullRequestCoordinates;
  command: Command;
  skipDrafts: boolean;
  skipBots: boolean;
  /** Lower-cased logins. */
  skipAuthors: ReadonlySet<string>;
  rejectForks: boolean;
  /** Branch the pull request must target, or empty for any. */
  baseBranch: string;
  /**
   * The head commit the review was asked for, when it is known. A pull request whose head has moved
   * since is skipped: the push that moved it starts a run of its own, which asks again.
   */
  expectedHeadSha?: string;
  /** Skip when CodeRabbit already reviewed the head commit, or a request for it is pending. */
  skipDuplicates: boolean;
  /** Collapse earlier commands of the token's account and CodeRabbit's replies to commands. */
  collapseOutdated: boolean;
}

/** What collapsing the outdated comments achieved. A failure there does not undo the posted command. */
export interface CollapseResult {
  collapsed: number;
  /** One message for each comment that could not be collapsed. */
  failures: string[];
}

export type TriggerOutcome =
  | { triggered: true; comment: PostedComment; actor: string; collapse: CollapseResult }
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
  if (options.baseBranch !== '' && pullRequest.baseRef !== options.baseBranch) {
    return 'other-base';
  }
  if (options.expectedHeadSha !== undefined && pullRequest.headSha !== options.expectedHeadSha) {
    return 'outdated';
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
        ? 'a GitHub App or GITHUB_TOKEN (GET /user answered 403)'
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

  const activity = await readActivity(api, options);

  if (options.skipDuplicates && activity.kind === 'read') {
    const duplicate = duplicateReason(activity.activity, pullRequest.headSha, identity.login);

    if (duplicate !== undefined) {
      return { skipReason: duplicate, triggered: false };
    }
  }

  const comment = await api.postComment(options.pullRequest, commandBody(options.command, pullRequest.headSha));
  let collapse: CollapseResult = { collapsed: 0, failures: [] };

  if (activity.kind === 'read' && options.collapseOutdated) {
    collapse = await collapseComments(api, outdatedComments(activity.activity, identity.login));
  } else if (activity.kind === 'unreadable') {
    collapse = { collapsed: 0, failures: [`could not read the comments: ${activity.message}`] };
  }

  return { actor: identity.login, collapse, comment, triggered: true };
}

type ActivityRead =
  | { kind: 'read'; activity: ReviewActivity }
  | { kind: 'skipped' }
  | { kind: 'unreadable'; message: string };

/**
 * Reads the comments and reviews when a rule needs them. A failure is fatal while
 * `skipDuplicates` relies on them; when only collapsing needs them, the command is still posted.
 */
async function readActivity(api: TriggerApi, options: TriggerOptions): Promise<ActivityRead> {
  if (!options.skipDuplicates && !options.collapseOutdated) {
    return { kind: 'skipped' };
  }

  try {
    return { activity: await api.getReviewActivity(options.pullRequest), kind: 'read' };
  } catch (error) {
    if (options.skipDuplicates) {
      throw error;
    }

    return { kind: 'unreadable', message: errorMessage(error) };
  }
}

/** Collapses each comment in turn, collecting failures instead of stopping at the first. */
async function collapseComments(api: TriggerApi, nodeIds: readonly string[]): Promise<CollapseResult> {
  const result: CollapseResult = { collapsed: 0, failures: [] };

  for (const nodeId of nodeIds) {
    try {
      await api.minimizeComment(nodeId);
      result.collapsed += 1;
    } catch (error) {
      // The command is already posted, so a comment that stays expanded is reported, not fatal.
      result.failures.push(`${nodeId}: ${errorMessage(error)}`);
    }
  }

  return result;
}
