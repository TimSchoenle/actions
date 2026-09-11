import { hasStatus } from 'actions-util';
import { createOctokit } from 'actions-util/client';

import { IssueUnavailableError } from './issue-api.js';

import type { ExistingIssue, IssueApi, IssueRef, IssueSearchState, IssueWrite } from './issue-api.js';
import type { RepositoryCoordinates } from 'actions-util';

/** GitHub's ceiling on `per_page`, so a repository's issues arrive in as few requests as possible. */
const MAX_PAGE_SIZE = 100;

/**
 * The statuses that mean the issue is gone: 404 for the issue itself -- or for a repository the token
 * can no longer see, which GitHub does not distinguish.
 *
 * A 403 is deliberately *not* here, although it is what GitHub answers when the token may open issues
 * but may not edit somebody else's. Falling back on it would open a fresh issue on every single run:
 * the issue that provoked the refusal is still the oldest one carrying the marker, so the next run
 * finds it, is refused again, and adds another. Failing instead says exactly once that the marker was
 * found on an issue this identity does not own, which the `author` input is there to prevent. A rate
 * limit reports as 403 too, which is a second reason not to read that status as "deleted".
 */
const UNAVAILABLE_STATUSES = [404, 410];

/** Whether an update failure is one that opening a new issue would resolve. */
function isUnavailable(error: unknown): boolean {
  return UNAVAILABLE_STATUSES.some((status) => hasStatus(error, status));
}

/** Whether creating a label failed because it already exists, rather than for some other reason. */
const LABEL_CONFLICT_STATUS = 422;

type Octokit = ReturnType<typeof createOctokit>;

/**
 * Creates every label in `labels` that the repository does not already have.
 *
 * GitHub does not create a label named in an issue's `labels` array on its behalf -- unlike the web
 * UI, the REST API 422s on a name it does not recognise. Tolerating the 422 this raises for a name
 * that already exists is what makes the call idempotent: every run of an action that enforces the
 * same label set would otherwise have to track what it already created.
 */
async function ensureLabelsExist(octokit: Octokit, owner: string, repo: string, labels: string[]): Promise<void> {
  for (const name of labels) {
    try {
      await octokit.rest.issues.createLabel({ name, owner, repo });
    } catch (error) {
      if (!hasStatus(error, LABEL_CONFLICT_STATUS)) {
        throw error;
      }
    }
  }
}

/** Reduces the labels GitHub returns -- a mix of plain names and label objects -- to plain names. */
function labelNames(labels: (string | { name?: string | null })[]): string[] {
  return labels.map((label) => (typeof label === 'string' ? label : (label.name ?? ''))).filter((name) => name !== '');
}

/**
 * Binds the {@link IssueApi} to the GitHub REST API.
 */
export function createIssueApi(token: string): IssueApi {
  const octokit = createOctokit(token);

  return {
    async *issues({ owner, repo }: RepositoryCoordinates, state: IssueSearchState): AsyncIterable<ExistingIssue> {
      // `octokit.paginate.iterator` is what keeps the early exit real: abandoning the loop after the
      // first match stops the generator, and the pages beyond it are never requested.
      const pages = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
        owner,
        per_page: MAX_PAGE_SIZE,
        repo,
        state,
      });

      for await (const { data } of pages) {
        for (const issue of data) {
          // GitHub models a pull request as an issue with a branch, and `listForRepo` returns both.
          // This action's scope is plain issues, so a pull request carrying a forged marker in its
          // body must never be mistaken for the issue this action is looking for.
          if (issue.pull_request !== undefined) {
            continue;
          }

          yield {
            author: issue.user?.login ?? '',
            body: issue.body ?? '',
            labels: labelNames(issue.labels),
            number: issue.number,
            state: issue.state === 'closed' ? 'closed' : 'open',
            title: issue.title,
            url: issue.html_url,
          };
        }
      }
    },

    async createIssue(
      { owner, repo }: RepositoryCoordinates,
      title: string,
      body: string,
      labels: string[],
    ): Promise<IssueRef> {
      if (labels.length > 0) {
        await ensureLabelsExist(octokit, owner, repo, labels);
      }

      const { data } = await octokit.rest.issues.create({
        body,
        labels,
        owner,
        repo,
        title,
      });

      return { number: data.number, url: data.html_url };
    },

    async updateIssue(
      { owner, repo }: RepositoryCoordinates,
      issueNumber: number,
      changes: IssueWrite,
    ): Promise<IssueRef> {
      if (changes.labels !== undefined && changes.labels.length > 0) {
        await ensureLabelsExist(octokit, owner, repo, changes.labels);
      }

      try {
        const { data } = await octokit.rest.issues.update({
          issue_number: issueNumber,
          owner,
          repo,
          ...changes,
        });

        return { number: data.number, url: data.html_url };
      } catch (error) {
        if (!isUnavailable(error)) {
          throw error;
        }

        throw new IssueUnavailableError(`issue ${issueNumber} can no longer be updated`, { cause: error });
      }
    },
  };
}
