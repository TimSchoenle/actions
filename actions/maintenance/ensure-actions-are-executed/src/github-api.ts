import * as github from '@actions/github';

import type { CheckRun, CheckRunsApi, RepositoryCoordinates } from './checks.js';

/** Page size for every listing. The API caps it at 100, so this is the fewest possible round trips. */
const PER_PAGE = 100;

/** A page of records, plus the pagination cursor the caller advances. */
type PageReader<T> = (page: number) => Promise<T[]>;

/**
 * Reads every page of a listing.
 *
 * A short page ends the traversal, which is what the REST API guarantees: only the last page may
 * contain fewer than `per_page` records. Relying on that rather than on the `Link` header keeps this
 * adapter free of header parsing and matches what the shell predecessor did.
 */
async function readAllPages<T>(read: PageReader<T>): Promise<T[]> {
  const records: T[] = [];

  for (let page = 1; ; page += 1) {
    const pageRecords = await read(page);
    records.push(...pageRecords);

    if (pageRecords.length < PER_PAGE) {
      return records;
    }
  }
}

/**
 * Binds the {@link CheckRunsApi} to the GitHub REST API.
 *
 * Errors are never translated here — the caller decides which of the two listings may fail (see
 * `collectCheckRuns`), and a swallowed error at this level would make that decision impossible.
 */
export function createCheckRunsApi(token: string): CheckRunsApi {
  const octokit = github.getOctokit(token);

  return {
    async listCheckRunsForRef({ owner, repo }: RepositoryCoordinates, ref: string): Promise<CheckRun[]> {
      return readAllPages(async (page) => {
        const { data } = await octokit.rest.checks.listForRef({ owner, page, per_page: PER_PAGE, ref, repo });

        return data.check_runs.map((checkRun) => ({
          conclusion: checkRun.conclusion,
          detailsUrl: checkRun.details_url,
          id: checkRun.id,
          name: checkRun.name,
          status: checkRun.status,
        }));
      });
    },

    async listWorkflowRunJobs({ owner, repo }: RepositoryCoordinates, runId: number): Promise<CheckRun[]> {
      return readAllPages(async (page) => {
        const { data } = await octokit.rest.actions.listJobsForWorkflowRun({
          owner,
          page,
          per_page: PER_PAGE,
          repo,
          run_id: runId,
        });

        // A job carries the same status/conclusion vocabulary as a check run; `html_url` is the
        // equivalent of a check run's `details_url`.
        return data.jobs.map((job) => ({
          conclusion: job.conclusion,
          detailsUrl: job.html_url,
          id: job.id,
          name: job.name,
          status: job.status,
        }));
      });
    },
  };
}
