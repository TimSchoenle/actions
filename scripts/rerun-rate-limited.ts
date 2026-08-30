import chalk from 'chalk';

import {
  DEFAULT_SWEEP_POLICY,
  type GitHubApi,
  type JobAnnotation,
  type RateLimitSnapshot,
  type SkippedRun,
  sweep,
  type SweepReport,
  type WorkflowRun,
} from './lib/rate-limit-rerun.js';

// Re-runs the workflow runs GitHub refused for rate limiting, once the installation budget behind them
// has recovered. Run on a schedule by .github/workflows/rate-limit-rerun.yml; the rules it applies live
// in ./lib/rate-limit-rerun.ts, which is where the unit suite exercises them.
//
// Reads and the re-run request use the ambient GITHUB_TOKEN, whose budget is per-repository and so is
// not the one under pressure. RATE_LIMIT_PROBE_TOKEN is a token minted from the *app installation* the
// watched workflows use, and is read only to ask whether that budget has recovered — `GET /rate_limit`
// is itself free, so the probe costs nothing it is trying to conserve.

const API_URL = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const API_VERSION = '2022-11-28';

/** How many failed runs are listed. Bounded well above the sweep's own inspection budget. */
const RUN_PAGE_SIZE = 100;

interface RawRun {
  id: number;
  name?: string;
  run_attempt?: number;
  created_at: string;
  head_branch: string | null;
}

interface RawJob {
  id: number;
  conclusion: string | null;
}

interface RawAnnotation {
  annotation_level?: string | null;
  title?: string | null;
  message?: string | null;
}

interface RawRateLimit {
  resources?: { core?: { limit?: number; remaining?: number; reset?: number } };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

/**
 * A minimal REST client over `fetch`.
 *
 * Deliberately not Octokit: this is a maintenance script, and pulling a full API client (and its
 * bundle) in to make five calls would be the only heavy dependency in `scripts/`.
 */
class RestClient {
  constructor(private readonly token: string) {}

  async call<T>(method: string, path: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': API_VERSION,
      },
    });

    if (!response.ok) {
      throw new Error(`${method} ${path} failed: ${response.status} ${response.statusText}`);
    }

    // The re-run endpoint answers with an empty body, so the response is read as text and only parsed
    // when there is something to parse — `response.json()` would throw on the empty string.
    const body = await response.text();

    return (body.length === 0 ? undefined : JSON.parse(body)) as T;
  }
}

function toWorkflowRun(raw: RawRun): WorkflowRun {
  return {
    id: raw.id,
    name: raw.name ?? '',
    attempt: raw.run_attempt ?? 1,
    createdAtMs: Date.parse(raw.created_at),
    headBranch: raw.head_branch ?? '',
  };
}

function toAnnotation(raw: RawAnnotation): JobAnnotation {
  return { level: raw.annotation_level ?? '', title: raw.title ?? '', message: raw.message ?? '' };
}

/** Binds the sweep's intentions to the REST endpoints that serve them for one repository. */
function githubApi(repository: string, reader: RestClient, probe: RestClient | undefined): GitHubApi {
  return {
    async budget(): Promise<RateLimitSnapshot | undefined> {
      if (probe === undefined) {
        return undefined;
      }

      const { resources } = await probe.call<RawRateLimit>('GET', '/rate_limit');

      return {
        limit: resources?.core?.limit ?? 0,
        remaining: resources?.core?.remaining ?? 0,
        resetEpochSeconds: resources?.core?.reset ?? 0,
      };
    },

    async listFailedRuns(): Promise<WorkflowRun[]> {
      const { workflow_runs: runs } = await reader.call<{ workflow_runs: RawRun[] }>(
        'GET',
        `/repos/${repository}/actions/runs?status=failure&per_page=${RUN_PAGE_SIZE}`,
      );

      return runs.map(toWorkflowRun);
    },

    async listFailedJobIds(runId: number): Promise<number[]> {
      const { jobs } = await reader.call<{ jobs: RawJob[] }>(
        'GET',
        `/repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=${RUN_PAGE_SIZE}`,
      );

      return jobs.filter((job) => job.conclusion === 'failure').map((job) => job.id);
    },

    // An Actions job and its check run share an id, which is the only route from a failed job to the
    // annotation that says why it failed — the jobs endpoint does not carry one.
    async annotationsOf(jobId: number): Promise<JobAnnotation[]> {
      const annotations = await reader.call<RawAnnotation[]>(
        'GET',
        `/repos/${repository}/check-runs/${jobId}/annotations`,
      );

      return annotations.map(toAnnotation);
    },

    async rerunFailedJobs(runId: number): Promise<void> {
      await reader.call('POST', `/repos/${repository}/actions/runs/${runId}/rerun-failed-jobs`);
    },
  };
}

function describe(run: WorkflowRun): string {
  return `${run.name} #${run.id} (${run.headBranch}, attempt ${run.attempt})`;
}

function reportSkipped(label: string, entries: readonly SkippedRun[]): void {
  if (entries.length === 0) {
    return;
  }

  console.log(chalk.gray(`${label}:`));
  for (const { run, reason } of entries) {
    console.log(chalk.gray(`  - ${describe(run)}: ${reason}`));
  }
}

function report(result: SweepReport, dryRun: boolean): void {
  if (result.budget) {
    const { remaining, limit } = result.budget;
    console.log(chalk.blue(`Installation budget: ${remaining} of ${limit} requests remaining.`));
  } else {
    console.log(chalk.yellow('No probe token: re-running without checking whether the budget has recovered.'));
  }

  if (result.deferred) {
    console.log(chalk.yellow(`Standing down — ${result.deferred}.`));

    return;
  }

  reportSkipped('Passed over', result.skipped);

  if (result.unrelated.length > 0) {
    console.log(chalk.gray(`Left alone (failed for reasons other than a rate limit): ${result.unrelated.length}.`));
  }

  for (const run of result.rerun) {
    console.log(chalk.green(`${dryRun ? 'Would re-run' : 'Re-ran'} ${describe(run)}.`));
  }

  reportSkipped('Could not be re-run', result.failed);

  if (result.rerun.length === 0 && result.failed.length === 0) {
    console.log(chalk.blue('Nothing was refused for rate limiting; no re-runs needed.'));
  }
}

export async function main(): Promise<void> {
  const repository = requireEnvironment('GITHUB_REPOSITORY');
  const reader = new RestClient(requireEnvironment('GITHUB_TOKEN'));
  const probeToken = process.env.RATE_LIMIT_PROBE_TOKEN;
  const dryRun = process.env.DRY_RUN === 'true';

  const api = githubApi(repository, reader, probeToken ? new RestClient(probeToken) : undefined);
  const result = await sweep(api, DEFAULT_SWEEP_POLICY, Date.now(), { dryRun });

  report(result, dryRun);

  // A re-run that could not be requested is the one outcome an operator has to see; everything else
  // this sweep decides is routine and belongs in the log, not in a red check.
  if (result.failed.length > 0) {
    throw new Error(`${result.failed.length} run(s) could not be re-run.`);
  }
}

if (import.meta.main) {
  await main();
}
