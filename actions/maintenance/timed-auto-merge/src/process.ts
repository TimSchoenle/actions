import { errorMessage, verifyCommits } from 'actions-util';

import type { BranchMatcher } from './branch-pattern.js';
import type { OpenPullRequest, TimedAutoMergeApi } from './github-api.js';
import type { MergeMethod } from './merge-method.js';
import type { RepositoryCoordinates } from 'actions-util';

/** Everything read from the action inputs that the decision needs, already validated. */
export interface TimedAutoMergeRequest {
  repository: RepositoryCoordinates;
  matcher: BranchMatcher;
  /** How long ago the pull request must have been opened, in milliseconds. */
  minimumOpenMs: number;
  trustedAuthorIds: readonly number[];
  /** Database IDs of the accounts a pull request may be opened by. */
  prAuthorIds: readonly number[];
  /** The base branch a pull request must target, or empty for any. */
  baseBranch: string;
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
  | 'author-untrusted'
  | 'base-mismatch'
  | 'commits-unverified'
  | 'draft'
  | 'fork'
  | 'head-moved'
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
  /** `already-queued`: an earlier run approved `headSha` and auto-merge is on, so nothing was written. */
  merge: 'already-queued' | 'auto-merge-enabled' | 'merged';
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

/** Parses a timestamp GitHub returned, naming `what` it was when it cannot be read. */
function parseTimestamp(value: string, what: string): number {
  const milliseconds = Date.parse(value);

  if (Number.isNaN(milliseconds)) {
    throw new TypeError(`GitHub returned an unreadable ${what} ${JSON.stringify(value)}.`);
  }

  return milliseconds;
}

/**
 * Checks that need no further API call: the pull request is from this repository, opened by an
 * accepted account, into the expected base, ready for review and opened long enough ago.
 *
 * The age is measured from creation only, not from the newest commit. Renovate and release-please
 * rebase their pull requests whenever the base branch moves, so a wait that restarted on every push
 * would never end on an active repository.
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

  if (pullRequest.authorId === null || !request.prAuthorIds.includes(pullRequest.authorId)) {
    return skipped(
      pullRequest,
      'author-untrusted',
      `opened by ${pullRequest.authorId === null ? 'a deleted account' : String(pullRequest.authorId)}`,
    );
  }

  if (request.baseBranch !== '' && pullRequest.baseRef !== request.baseBranch) {
    return skipped(pullRequest, 'base-mismatch', `targets ${pullRequest.baseRef}, not ${request.baseBranch}`);
  }

  if (pullRequest.draft) {
    return skipped(pullRequest, 'draft', 'pull request is a draft');
  }

  const createdMs = parseTimestamp(pullRequest.createdAt, 'creation time');
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

  const merge = (await isQueued(api, pullRequest))
    ? 'already-queued'
    : await approveAndQueue(api, pullRequest, request);

  return {
    headRef: pullRequest.headRef,
    headSha: pullRequest.headSha,
    merge,
    number: pullRequest.number,
    status: 'approved',
  };
}

/**
 * Whether an earlier run already approved this head and auto-merge is still on, so approving and
 * enabling again would only add a duplicate review. Read only when the listing showed auto-merge on,
 * so a pull request that is not queued costs no extra request; the read itself is what confirms the
 * head, the approval and auto-merge, since any of them may have changed since the listing.
 */
async function isQueued(api: TimedAutoMergeApi, pullRequest: OpenPullRequest): Promise<boolean> {
  if (!pullRequest.autoMergeEnabled) {
    return false;
  }
  const state = await api.getMergeState(pullRequest.nodeId);

  return (
    state.headOid === pullRequest.headSha && state.autoMergeEnabled && state.viewerApprovedOid === pullRequest.headSha
  );
}

/** Approves at the listed head, then enables auto-merge or merges; see {@link enableAutoMergeOrMerge}. */
async function approveAndQueue(
  api: TimedAutoMergeApi,
  pullRequest: OpenPullRequest,
  request: TimedAutoMergeRequest,
): Promise<ApprovedOutcome['merge']> {
  await api.approve(request.repository, pullRequest.number, pullRequest.headSha, request.approveMessage);

  return enableAutoMergeOrMerge(api, pullRequest, request);
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
