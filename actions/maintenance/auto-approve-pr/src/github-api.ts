import * as github from '@actions/github';
import { fetchPullRequestCommits } from 'actions-util/commits';

import type { PullRequestCoordinates } from './pull-request-url.js';
import type { PullRequestCommits } from 'actions-util/commits';

/** A pull request reduced to the fields the auto-approval decision needs. */
export interface PullRequestInfo {
  /** Database ID of the pull request author. */
  authorId: number;
  /** Head branch name, e.g. `feature/x`. */
  headRef: string;
  /** Full name of the head repository, e.g. `owner/repo`. */
  headRepoFullName: string;
  /** Full name of the base repository, e.g. `owner/repo`. */
  baseRepoFullName: string;
  /** Number of files the pull request changes. */
  changedFiles: number;
}

/** The GitHub operations this action needs, kept minimal so it can be faked in tests. */
export interface AutoApproveApi {
  /** Reads the fields of a pull request the decision depends on. */
  getPullRequest(coordinates: PullRequestCoordinates): Promise<PullRequestInfo>;
  /** Fetches the pull request's commits for author/signature verification. */
  fetchCommits(prUrl: string): Promise<PullRequestCommits>;
  /** Submits an approving review with the given body. */
  approve(coordinates: PullRequestCoordinates, message: string): Promise<void>;
}

export function createAutoApproveApi(token: string): AutoApproveApi {
  const octokit = github.getOctokit(token);

  return {
    async approve({ number, owner, repo }: PullRequestCoordinates, message: string): Promise<void> {
      await octokit.rest.pulls.createReview({ body: message, event: 'APPROVE', owner, pull_number: number, repo });
    },

    async fetchCommits(prUrl: string): Promise<PullRequestCommits> {
      return fetchPullRequestCommits(token, prUrl);
    },

    async getPullRequest({ number, owner, repo }: PullRequestCoordinates): Promise<PullRequestInfo> {
      const { data } = await octokit.rest.pulls.get({ owner, pull_number: number, repo });

      const headRepoFullName = data.head.repo?.full_name;
      const baseRepoFullName = data.base.repo?.full_name;

      // Incomplete data must never read as a benign outcome: a missing author or head repository would
      // otherwise let a fork check or author check silently pass. The head repository is absent only
      // when a fork has been deleted, which reject_forks would reject anyway.
      if (!data.user || !data.head.ref || !headRepoFullName || !baseRepoFullName) {
        throw new Error(`Incomplete data for pull request #${number}; refusing to evaluate it for auto-approval.`);
      }

      return {
        authorId: data.user.id,
        baseRepoFullName,
        changedFiles: data.changed_files,
        headRef: data.head.ref,
        headRepoFullName,
      };
    },
  };
}
