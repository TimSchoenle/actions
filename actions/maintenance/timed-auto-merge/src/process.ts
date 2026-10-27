import { errorMessage, verifyCommits } from 'actions-util';

import type { BranchMatcher } from './branch-pattern.js';
import type { OpenPullRequest, TimedAutoMergeApi } from './github-api.js';
import type { MergeMethod } from './merge-method.js';
import type { RepositoryCoordinates } from 'actions-util';

/** Everything read from the action inputs that the decision needs, already validated. */
export interface TimedAutoMergeRequest {
  repository: RepositoryCoordinates;
  matcher: BranchMatcher;
  /**
   * How long a pull request must have been open, and how long ago its head must have been pushed,
   * in milliseconds.
   */
  minimumOpenMs: number;
  trustedAuthorIds: readonly number[];
  mergeMethod: MergeMethod;
  approveMessage: string;
  /** The current time in epoch milliseconds, injected so tests need no clock. */
  nowMs: number;
}

/**
 * Why a matching pull request was left alone. None of these is an error: each is a check that did
 * not pass, and the next scheduled run looks at the pull request again.
 */
export type SkipReason =
  | 'commits-unverified'
  | 'draft'
  | 'fork'
  | 'head-age-unknown'
  | 'head-moved'
  | 'head-too-young'
  | 'too-young';

interface OutcomeBase {
  number: number;
  headRef: string;
}

/**
 * Approved at `headSha`, then either auto-merge enabled with `headSha` as the expected head, or, when
 * the pull request was already mergeable, merged at `headSha`.
 */
export interface ApprovedOutcome extends OutcomeBase {
  status: 'approved';
  headSha: string;
  merge: 'auto-merge-enabled' | 'merged';
}

export interface SkippedOutcome extends OutcomeBase {
  status: 'skipped';
  reason: SkipReason;
  /** Human-readable explanation for the log and the step summary. */
  detail: string;
}

/** An API call failed. The pull request may have been approved without auto-merge being enabled. */
export interface FailedOutcome extends OutcomeBase {
  status: 'failed';
  message: string;
}

export type PullRequestOutcome = ApprovedOutcome | FailedOutcome | SkippedOutcome;

/** The pull requests whose head branch matched, each with what happened to it, in listing order. */
export interface TimedAutoMergeReport {
  /** Number of open pull requests listed, matching or not. */
  openCount: number;
  outcomes: PullRequestOutcome[];
}

function skipped(pullRequest: OpenPullRequest, reason: SkipReason, detail: string): SkippedOutcome {
  return { detail, headRef: pullRequest.headRef, number: pullRequest.number, reason, status: 'skipped' };
}

/** Renders a duration in the largest whole unit, for messages. */
function formatAge(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);

  if (minutes < 120) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * Checks that need no further API call: the pull request is from this repository, ready for review
 * and old enough.
 *
 * A fork is never eligible. Its branch name is chosen by whoever owns the fork, so the branch pattern
 * says nothing about it, and this action exists to merge branches that automation in the base
 * repository created.
 *
 * @throws if `createdAt` is not a timestamp, which the caller records as a failure.
 */
function precheck(pullRequest: OpenPullRequest, request: TimedAutoMergeRequest): SkippedOutcome | undefined {
  if (pullRequest.headRepoFullName !== pullRequest.baseRepoFullName) {
    return skipped(pullRequest, 'fork', `head repository is ${pullRequest.headRepoFullName ?? 'a deleted fork'}`);
  }

  if (pullRequest.draft) {
    return skipped(pullRequest, 'draft', 'pull request is a draft');
  }

  const createdMs = Date.parse(pullRequest.createdAt);

  if (Number.isNaN(createdMs)) {
    throw new TypeError(`GitHub returned an unreadable creation time ${JSON.stringify(pullRequest.createdAt)}.`);
  }

  const ageMs = request.nowMs - createdMs;

  if (ageMs < request.minimumOpenMs) {
    return skipped(
      pullRequest,
      'too-young',
      `open for ${formatAge(Math.max(ageMs, 0))}, needs ${formatAge(request.minimumOpenMs)}`,
    );
  }

  return undefined;
}

/**
 * Checks that the current head has itself been in place for `minimumOpenMs`, not only the pull
 * request.
 *
 * Measuring from the opening alone would let a commit pushed to an old pull request merge on the next
 * run, with no time for anyone to notice it. The push time comes from the repository activity log,
 * which GitHub records itself; a commit's own dates are chosen by whoever creates it. When the latest
 * recorded update of the branch is not the verified head, its age is unknown and the pull request
 * waits.
 *
 * @throws if the activity log cannot be read or its timestamp is not one, which the caller records as
 * a failure.
 */
async function checkHeadAge(
  api: TimedAutoMergeApi,
  pullRequest: OpenPullRequest,
  request: TimedAutoMergeRequest,
): Promise<SkippedOutcome | undefined> {
  const update = await api.latestBranchUpdate(request.repository, pullRequest.headRef);

  if (update?.sha !== pullRequest.headSha) {
    const latest = update ? `the latest recorded push is ${update.sha}` : 'no push is recorded';

    return skipped(pullRequest, 'head-age-unknown', `${latest}, expected the verified head ${pullRequest.headSha}`);
  }

  const pushedMs = Date.parse(update.timestamp);

  if (Number.isNaN(pushedMs)) {
    throw new TypeError(`GitHub returned an unreadable push time ${JSON.stringify(update.timestamp)}.`);
  }

  const ageMs = request.nowMs - pushedMs;

  if (ageMs < request.minimumOpenMs) {
    return skipped(
      pullRequest,
      'head-too-young',
      `head pushed ${formatAge(Math.max(ageMs, 0))} ago, needs ${formatAge(request.minimumOpenMs)}`,
    );
  }

  return undefined;
}

/**
 * Verifies, approves and enables auto-merge on one pull request, or merges it when it is already
 * mergeable, every step pinned to the head SHA seen in the listing.
 *
 * The commit list must end at that SHA. Otherwise the branch moved after the listing, and the
 * commits that were verified are not the ones that would merge. The review is then attached to the
 * SHA with `commit_id`, and auto-merge is enabled with it as `expectedHeadOid`, so a push that lands
 * between verification and either call cannot be merged by this run.
 */
async function processOne(
  api: TimedAutoMergeApi,
  pullRequest: OpenPullRequest,
  request: TimedAutoMergeRequest,
): Promise<PullRequestOutcome> {
  const early = precheck(pullRequest, request);

  if (early) {
    return early;
  }

  const { commits, headOid } = await api.fetchCommits(pullRequest.url);

  // Listing and fetching the commits are two reads. A push between them would have the checks above
  // judge one head and the commit check another; the next run decides the new head.
  if (headOid !== pullRequest.headSha) {
    return skipped(
      pullRequest,
      'head-moved',
      `commits were read at ${headOid}, expected the listed head ${pullRequest.headSha}`,
    );
  }

  if (commits.length === 0) {
    return skipped(pullRequest, 'commits-unverified', 'the pull request has no commits');
  }

  const verification = verifyCommits(commits, request.trustedAuthorIds);

  if (!verification.verified) {
    const reasons = verification.failures.map((failure) => `${failure.oid}: ${failure.reasons.join('; ')}`);

    return skipped(pullRequest, 'commits-unverified', reasons.join(' | '));
  }

  const headTooYoung = await checkHeadAge(api, pullRequest, request);

  if (headTooYoung) {
    return headTooYoung;
  }

  await api.approve(request.repository, pullRequest.number, pullRequest.headSha, request.approveMessage);

  const merge = await enableAutoMergeOrMerge(api, pullRequest, request);

  return {
    headRef: pullRequest.headRef,
    headSha: pullRequest.headSha,
    merge,
    number: pullRequest.number,
    status: 'approved',
  };
}

/**
 * The merge states in which GitHub refuses to enable auto-merge because nothing is left to wait for,
 * so the pull request has to be merged directly. `gh pr merge --auto`, which the reusable workflow
 * used, merges in the same three states. The ruleset still applies to the direct merge.
 */
const IMMEDIATELY_MERGEABLE: ReadonlySet<string> = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);

/**
 * Enables auto-merge, or merges directly when GitHub refused auto-merge because the pull request is
 * already mergeable.
 *
 * The refusal is recognised from the merge state read afterwards, not from the error text, which
 * GitHub does not document. The direct merge passes `sha`, so it is pinned to the verified head just
 * as `expectedHeadOid` pins auto-merge.
 */
async function enableAutoMergeOrMerge(
  api: TimedAutoMergeApi,
  pullRequest: OpenPullRequest,
  request: TimedAutoMergeRequest,
): Promise<ApprovedOutcome['merge']> {
  try {
    await api.enableAutoMerge(pullRequest.nodeId, request.mergeMethod, pullRequest.headSha);

    return 'auto-merge-enabled';
  } catch (enableError) {
    // The approval already stands, which an operator reading only "failed" would not guess.
    const failed = (message: string, cause: unknown): Error =>
      new Error(`Approved at ${pullRequest.headSha}, but ${message}`, { cause });
    // An unreadable merge state leaves the refusal unexplained, so the original error is reported.
    const state = await api.getMergeState(pullRequest.nodeId).catch(() => undefined);

    if (!state || state.headOid !== pullRequest.headSha || !IMMEDIATELY_MERGEABLE.has(state.status)) {
      throw failed(`enabling auto-merge failed: ${errorMessage(enableError)}`, enableError);
    }

    try {
      await api.merge(request.repository, pullRequest.number, request.mergeMethod, pullRequest.headSha);
    } catch (mergeError) {
      throw failed(
        `auto-merge was refused (merge state ${state.status}) and merging directly failed: ${errorMessage(mergeError)}`,
        mergeError,
      );
    }

    return 'merged';
  }
}

/**
 * Lists the open pull requests, keeps those whose head branch matches, and processes them one after
 * another.
 *
 * Sequential on purpose: processing the pull requests in parallel, such as one matrix job each, would
 * draw on the same installation rate limit at the same moment. A failure on one pull request is
 * recorded and the rest are still processed; deciding whether that fails the step is the caller's.
 *
 * @throws if the listing fails or the branch pattern exhausts its time budget, since then no pull
 * request can be judged.
 */
export async function processPullRequests(
  api: TimedAutoMergeApi,
  request: TimedAutoMergeRequest,
): Promise<TimedAutoMergeReport> {
  const open = await api.listOpenPullRequests(request.repository);
  const matches = request.matcher.matchAll(open.map((pullRequest) => pullRequest.headRef));
  const candidates = open.filter((_pullRequest, index) => matches[index]);
  const outcomes: PullRequestOutcome[] = [];

  for (const pullRequest of candidates) {
    try {
      outcomes.push(await processOne(api, pullRequest, request));
    } catch (error) {
      outcomes.push({
        headRef: pullRequest.headRef,
        message: errorMessage(error),
        number: pullRequest.number,
        status: 'failed',
      });
    }
  }

  return { openCount: open.length, outcomes };
}
