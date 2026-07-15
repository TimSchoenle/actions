import { parseUserIds, verifyBranch, verifyCommits } from 'actions-util';

import { parsePullRequestUrl } from './pull-request-url.js';

import type { AutoApproveApi } from './github-api.js';

/** Everything read from the action inputs that the decision needs. */
export interface AutoApproveRequest {
  /** URL of the pull request to consider. */
  prUrl: string;
  /** Comma-separated database IDs of accepted authors. */
  userIds: string;
  /** POSIX-ERE pattern the head branch must match. */
  branchPattern: string;
  /** Whether a pull request opened from a fork must be rejected. */
  rejectForks: boolean;
  /** Whether a pull request that changes no files must be skipped. */
  ignoreEmptyPrs: boolean;
  /** Body of the approving review. */
  approveMessage: string;
}

/** Why a pull request was not approved. Each maps to a check that did not pass. */
export type SkipReason = 'author-not-accepted' | 'branch-unverified' | 'no-changes' | 'commits-unverified';

/** The decision: whether the pull request was approved, and if not, which check stopped it. */
export interface AutoApproveOutcome {
  approved: boolean;
  skipReason?: SkipReason;
}

/**
 * Decides whether a pull request may be auto-approved and, if so, approves it.
 *
 * The checks run in the same order as the composite version and short-circuit: author, then branch
 * and fork, then a non-empty diff, then commit authorship and signatures. Every check must pass
 * before the approving review is submitted, so a single failing check leaves the pull request
 * untouched. Not approving is a normal outcome reported through {@link AutoApproveOutcome.skipReason},
 * not a failure — only malformed inputs or an API error fail the step.
 *
 * @throws if the URL cannot be parsed, if `userIds` is malformed, or if the API rejects a request.
 */
export async function autoApprove(api: AutoApproveApi, request: AutoApproveRequest): Promise<AutoApproveOutcome> {
  const coordinates = parsePullRequestUrl(request.prUrl);
  const acceptedIds = parseUserIds(request.userIds);

  const pullRequest = await api.getPullRequest(coordinates);

  if (!acceptedIds.includes(pullRequest.authorId)) {
    return { approved: false, skipReason: 'author-not-accepted' };
  }

  const branch = verifyBranch({
    baseRepoFullName: pullRequest.baseRepoFullName,
    branchPattern: request.branchPattern,
    headRef: pullRequest.headRef,
    headRepoFullName: pullRequest.headRepoFullName,
    rejectForks: request.rejectForks,
  });

  if (!branch.verified) {
    return { approved: false, skipReason: 'branch-unverified' };
  }

  if (request.ignoreEmptyPrs && pullRequest.changedFiles === 0) {
    return { approved: false, skipReason: 'no-changes' };
  }

  const { commits } = await api.fetchCommits(request.prUrl);

  if (!verifyCommits(commits, acceptedIds).verified) {
    return { approved: false, skipReason: 'commits-unverified' };
  }

  await api.approve(coordinates, request.approveMessage);

  return { approved: true };
}
