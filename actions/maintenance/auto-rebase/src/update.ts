import { errorMessage, hasStatus, quoteForLog } from 'actions-util';
import * as core from 'actions-util/core';

import type { PullRequestDetail, PullRequestSummary, UpdateBranchApi } from './github-api.js';
import type { RepositoryCoordinates } from 'actions-util';

/**
 * Why a labelled pull request was left alone.
 *
 * - `auto-merge-off`: auto-merge is off, and `only_auto_merge` is set.
 * - `conflicting`: GitHub reports a merge conflict with the base, so an update would be rejected.
 * - `limit-reached`: older pull requests already took every slot `limit` allows.
 * - `not-open`: closed or merged after it was listed, or deleted.
 * - `label-removed`: the label came off after it was listed.
 * - `draft`: a draft, and `skip_drafts` is set.
 * - `head-repository-deleted`: its fork is gone, so there is no branch to update.
 * - `fork-not-writable`: its fork does not allow maintainers to push.
 * - `up-to-date`: the head already contains every commit of the base branch.
 */
export type SkipReason =
  | 'auto-merge-off'
  | 'conflicting'
  | 'draft'
  | 'fork-not-writable'
  | 'head-repository-deleted'
  | 'label-removed'
  | 'limit-reached'
  | 'not-open'
  | 'up-to-date';

/**
 * How an update failed.
 *
 * - `rejected`: GitHub answered 422. The update cannot be applied as asked: the branches conflict,
 *   the head moved since it was read, or there is nothing to merge. Expected in normal operation.
 * - `error`: anything else, such as a token without write access. Not expected, and what
 *   `fail_on_error` acts on.
 */
export type FailureKind = 'error' | 'rejected';

export interface SkippedPullRequest {
  number: number;
  reason: SkipReason;
}

export interface FailedPullRequest {
  number: number;
  kind: FailureKind;
  message: string;
}

export interface UpdateResult {
  /** Labelled pull requests, in the order they were processed. */
  matched: number[];
  updated: number[];
  skipped: SkippedPullRequest[];
  failed: FailedPullRequest[];
}

export interface UpdateOptions {
  repository: RepositoryCoordinates;
  label: string;
  skipDrafts: boolean;
  /** Consider only pull requests with auto-merge on. */
  onlyAutoMerge: boolean;
  /**
   * How many of the oldest qualifying pull requests to bring up to date, or `undefined` for all.
   * A pull request takes a slot when it is updated or already up to date, so an up-to-date pull
   * request at the front holds its slot until it merges, closes or loses its label.
   */
  limit: number | undefined;
}

/** GitHub's answer when a requested branch update cannot be applied. */
const UNPROCESSABLE = 422;

/** `MergeStateStatus` of a head that conflicts with its base. */
const DIRTY = 'DIRTY';

/** `MergeStateStatus` of a head that is missing base commits a ruleset requires it to have. */
const BEHIND = 'BEHIND';

/**
 * Whether a pull request's labels include `label`.
 *
 * Compared case-insensitively because GitHub compares label names that way: a repository cannot
 * hold both `Dependencies` and `dependencies`, so the two spellings always name the same label.
 */
export function hasLabel(labels: readonly string[], label: string): boolean {
  const wanted = label.toLowerCase();

  return labels.some((candidate) => candidate.toLowerCase() === wanted);
}

/**
 * The reason to leave a listed pull request alone without spending a call on it, or `undefined`
 * when it should be re-read. The re-read repeats the draft check, because the snapshot may be stale.
 */
function listingSkipReason(pullRequest: PullRequestSummary, options: UpdateOptions): SkipReason | undefined {
  if (options.onlyAutoMerge && !pullRequest.autoMergeEnabled) {
    return 'auto-merge-off';
  }

  if (options.skipDrafts && pullRequest.draft) {
    return 'draft';
  }

  if (pullRequest.mergeStateStatus === DIRTY) {
    return 'conflicting';
  }

  return undefined;
}

/** The reason to leave a re-read pull request alone, or `undefined` when it should be updated. */
function skipReason(pullRequest: PullRequestDetail, options: UpdateOptions): SkipReason | undefined {
  if (pullRequest.state !== 'open') {
    return 'not-open';
  }

  if (!hasLabel(pullRequest.labels, options.label)) {
    return 'label-removed';
  }

  if (options.skipDrafts && pullRequest.draft) {
    return 'draft';
  }

  if (pullRequest.headRepoFullName === null) {
    return 'head-repository-deleted';
  }

  if (pullRequest.headRepoFullName !== pullRequest.baseRepoFullName && !pullRequest.maintainerCanModify) {
    return 'fork-not-writable';
  }

  return undefined;
}

/**
 * Whether the head is missing commits from its base.
 *
 * `BEHIND` from the listing answers it without a call when the head has not moved since. Any other
 * status says nothing either way: a repository that does not require up-to-date branches reports a
 * behind head as `CLEAN`, and a pending review or check reports `BLOCKED`. Those are compared.
 *
 * Only an optimisation over sending the update and reading GitHub's 422, so a failed comparison is
 * answered with `true`: the update request is the authority, and it is sent regardless.
 */
async function isBehind(
  api: UpdateBranchApi,
  options: UpdateOptions,
  listed: PullRequestSummary,
  pullRequest: PullRequestDetail,
): Promise<boolean> {
  if (listed.mergeStateStatus === BEHIND && listed.headSha === pullRequest.headSha) {
    return true;
  }

  try {
    return (await api.commitsBehindBase(options.repository, pullRequest.baseRef, pullRequest.headSha)) > 0;
  } catch (error) {
    core.debug(`Could not compare #${pullRequest.number} with its base: ${errorMessage(error)}`);

    return true;
  }
}

type Outcome =
  | { kind: 'failed'; failure: FailedPullRequest }
  | { kind: 'skipped'; reason: SkipReason }
  | { kind: 'up-to-date' }
  | { kind: 'updated' };

/** Re-reads one pull request and requests its update when it still qualifies. */
async function processPullRequest(
  api: UpdateBranchApi,
  options: UpdateOptions,
  listed: PullRequestSummary,
): Promise<Outcome> {
  const { number } = listed;

  try {
    const pullRequest = await api.getPullRequest(options.repository, number);

    if (pullRequest === undefined) {
      return { kind: 'skipped', reason: 'not-open' };
    }

    const reason = skipReason(pullRequest, options);

    if (reason !== undefined) {
      return { kind: 'skipped', reason };
    }

    if (!(await isBehind(api, options, listed, pullRequest))) {
      return { kind: 'up-to-date' };
    }

    await api.updateBranch(options.repository, number, pullRequest.headSha);

    return { kind: 'updated' };
  } catch (error) {
    const kind: FailureKind = hasStatus(error, UNPROCESSABLE) ? 'rejected' : 'error';

    return { failure: { kind, message: errorMessage(error), number }, kind: 'failed' };
  }
}

/** Logs one outcome the way a reader of the job log needs it. */
function report(number: number, outcome: Outcome): void {
  switch (outcome.kind) {
    case 'updated': {
      core.info(`#${number}: update requested.`);
      break;
    }
    case 'skipped': {
      core.info(`#${number}: skipped (${outcome.reason}).`);
      break;
    }
    case 'up-to-date': {
      core.info(`#${number}: skipped (up-to-date).`);
      break;
    }
    case 'failed': {
      const { kind, message } = outcome.failure;

      if (kind === 'rejected') {
        core.warning(`#${number}: GitHub rejected the update, likely a conflict or a moved head: ${message}`);
      } else {
        core.error(`#${number}: update failed: ${message}`);
      }
      break;
    }
  }
}

/**
 * Whether an outcome takes one of the slots `limit` allows: a pull request that was brought up to
 * date or already was. A skipped or failed one cannot merge next, so it leaves its slot to the next.
 */
function takesSlot(outcome: Outcome): boolean {
  return outcome.kind === 'updated' || outcome.kind === 'up-to-date';
}

/**
 * Requests an update for every open pull request carrying the label, oldest first.
 *
 * The listing is a snapshot, and the rules it can decide (`only_auto_merge`, `skip_drafts`, a
 * reported conflict, `limit`) cost no further call. Every other candidate is re-read before it is
 * touched, because by the time its turn comes it may be closed, unlabelled or pushed to. The update
 * is conditioned on the head commit that re-read returned.
 *
 * A failure on one pull request is recorded and the rest are still processed; only a failure to
 * list the pull requests at all propagates.
 */
export async function updateLabelledPullRequests(api: UpdateBranchApi, options: UpdateOptions): Promise<UpdateResult> {
  const open = await api.listOpenPullRequests(options.repository);
  const labelled = open.filter((pullRequest) => hasLabel(pullRequest.labels, options.label));

  core.info(`${labelled.length} of ${open.length} open pull request(s) carry the label ${quoteForLog(options.label)}.`);

  const result: UpdateResult = {
    failed: [],
    matched: labelled.map(({ number }) => number),
    skipped: [],
    updated: [],
  };
  let slotsTaken = 0;

  for (const listed of labelled) {
    const { number } = listed;
    const listingReason = listingSkipReason(listed, options);
    let outcome: Outcome;

    if (listingReason !== undefined) {
      outcome = { kind: 'skipped', reason: listingReason };
    } else if (options.limit !== undefined && slotsTaken >= options.limit) {
      outcome = { kind: 'skipped', reason: 'limit-reached' };
    } else {
      outcome = await processPullRequest(api, options, listed);

      if (takesSlot(outcome)) {
        slotsTaken += 1;
      }
    }

    report(number, outcome);

    switch (outcome.kind) {
      case 'updated': {
        result.updated.push(number);
        break;
      }
      case 'skipped': {
        result.skipped.push({ number, reason: outcome.reason });
        break;
      }
      case 'up-to-date': {
        result.skipped.push({ number, reason: 'up-to-date' });
        break;
      }
      case 'failed': {
        result.failed.push(outcome.failure);
        break;
      }
    }
  }

  return result;
}
