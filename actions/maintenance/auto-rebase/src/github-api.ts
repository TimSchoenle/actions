import { resolveOptional } from 'actions-util';
import { createOctokit } from 'actions-util/client';

import type { RepositoryCoordinates } from 'actions-util';

/** An open pull request as the list endpoint reports it. */
export interface PullRequestSummary {
  number: number;
  labels: string[];
}

/** A pull request re-read just before it is updated. */
export interface PullRequestDetail {
  number: number;
  state: string;
  draft: boolean;
  labels: string[];
  /** The head commit the update is conditioned on. */
  headSha: string;
  /** Full name of the head repository, or `null` when that fork has been deleted. */
  headRepoFullName: string | null;
  /** Full name of the base repository, e.g. `owner/repo`. */
  baseRepoFullName: string;
  /** Base branch name, e.g. `main`. */
  baseRef: string;
  /** Whether the base repository's maintainers may push to a fork's head branch. */
  maintainerCanModify: boolean;
}

/** The GitHub operations this action needs, kept minimal so it can be faked in tests. */
export interface UpdateBranchApi {
  /** Every open pull request in the repository, across all pages. */
  listOpenPullRequests(repository: RepositoryCoordinates): Promise<PullRequestSummary[]>;
  /** One pull request, or `undefined` when it no longer exists. */
  getPullRequest(repository: RepositoryCoordinates, number: number): Promise<PullRequestDetail | undefined>;
  /** How many commits on `baseRef` the commit `headSha` does not contain. */
  commitsBehindBase(repository: RepositoryCoordinates, baseRef: string, headSha: string): Promise<number>;
  /**
   * Asks GitHub to merge the base branch into the head branch.
   *
   * Conditioned on `expectedHeadSha`: GitHub rejects the request with 422 when the head has moved
   * since it was read, so a push that lands in between is never merged over unseen.
   */
  updateBranch(repository: RepositoryCoordinates, number: number, expectedHeadSha: string): Promise<void>;
}

/** GitHub's ceiling on `per_page` for the pull request list. */
const PAGE_SIZE = 100;

export function createUpdateBranchApi(token: string): UpdateBranchApi {
  const octokit = createOctokit(token);

  return {
    async commitsBehindBase({ owner, repo }: RepositoryCoordinates, baseRef: string, headSha: string): Promise<number> {
      // One commit per page: only the counts are read, and the default page would carry 250 commits.
      const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
        basehead: `${baseRef}...${headSha}`,
        owner,
        page: 1,
        per_page: 1,
        repo,
      });

      return data.behind_by;
    },

    async getPullRequest(
      { owner, repo }: RepositoryCoordinates,
      number: number,
    ): Promise<PullRequestDetail | undefined> {
      const response = await resolveOptional(octokit.rest.pulls.get({ owner, pull_number: number, repo }));

      if (response === undefined) {
        return undefined;
      }

      const { data } = response;

      return {
        baseRef: data.base.ref,
        baseRepoFullName: data.base.repo.full_name,
        draft: data.draft === true,
        headRepoFullName: data.head.repo?.full_name ?? null,
        headSha: data.head.sha,
        labels: data.labels.map((label) => label.name),
        maintainerCanModify: data.maintainer_can_modify,
        number: data.number,
        state: data.state,
      };
    },

    async listOpenPullRequests({ owner, repo }: RepositoryCoordinates): Promise<PullRequestSummary[]> {
      const pullRequests: PullRequestSummary[] = [];
      const pages = octokit.paginate.iterator(octokit.rest.pulls.list, {
        owner,
        per_page: PAGE_SIZE,
        repo,
        state: 'open',
      });

      for await (const { data } of pages) {
        for (const pullRequest of data) {
          pullRequests.push({ labels: pullRequest.labels.map((label) => label.name), number: pullRequest.number });
        }
      }

      return pullRequests;
    },

    async updateBranch({ owner, repo }: RepositoryCoordinates, number: number, expectedHeadSha: string): Promise<void> {
      await octokit.rest.pulls.updateBranch({ expected_head_sha: expectedHeadSha, owner, pull_number: number, repo });
    },
  };
}
