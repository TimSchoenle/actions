/**
 * The GitHub operations this action needs, named so the decision in `upsert.ts` can be tested without
 * an HTTP client and so nothing above this line has to know what a status code is.
 */
import type { RepositoryCoordinates } from 'actions-util';

/** An issue this run created or updated, reduced to what the action publishes as outputs. */
export interface IssueRef {
  number: number;
  url: string;
}

/** An issue already on the repository, reduced to what the decision reads. */
export interface ExistingIssue extends IssueRef {
  title: string;
  body: string;
  state: 'open' | 'closed';
  /** Names of the labels currently on the issue. */
  labels: string[];
  /** Login of whoever opened it, e.g. `my-app[bot]`. */
  author: string;
}

/** The fields a write may change. Only the fields present are touched -- a reopen sends `state` alone. */
export interface IssueWrite {
  title?: string;
  body?: string;
  labels?: string[];
  state?: 'open' | 'closed';
}

/**
 * Raised when an issue is gone, and opening a new one is the right answer.
 *
 * Reserved for exactly that: the issue, or the repository holding it, no longer exists. Neither is
 * under the caller's control and neither is a reason to fail a build. Everything else propagates -- a
 * rate limit that outlived its retries, a network failure, a refusal to edit an issue this identity
 * does not own -- because none of them is mended by opening a duplicate, and a refusal that repeats
 * every run would add an issue every run.
 */
export class IssueUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IssueUnavailableError';
  }
}

/** The scope of a listing searched for the marker. */
export type IssueSearchState = 'open' | 'all';

/** The GitHub operations this action needs, kept minimal so it can be faked in tests. */
export interface IssueApi {
  /**
   * Every issue on the repository, most recently updated first.
   *
   * An iterable rather than an array because the caller stops at the first match, which on a
   * repository with a long history is the difference between one request and hundreds. Never yields
   * a pull request -- GitHub models one as an issue with a branch, and this action's scope is plain
   * issues only.
   */
  issues(target: RepositoryCoordinates, state: IssueSearchState): AsyncIterable<ExistingIssue>;
  /** Opens a new issue. */
  createIssue(target: RepositoryCoordinates, title: string, body: string, labels: string[]): Promise<IssueRef>;
  /**
   * Applies the given changes to an existing issue.
   *
   * @throws {@link IssueUnavailableError} if the issue can no longer be edited.
   */
  updateIssue(target: RepositoryCoordinates, issueNumber: number, changes: IssueWrite): Promise<IssueRef>;
}
