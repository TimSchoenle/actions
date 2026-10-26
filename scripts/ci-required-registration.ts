import fs from 'node:fs';
import path from 'node:path';

import {
  type ChangedFile,
  evaluateRegistration,
  PATH_FILTER_FILE_LIMIT,
  type PullRequestChange,
  pullRequestFilterOf,
  type Registration,
  type VerifyWorkflow,
  type WorkflowRunSummary,
} from './lib/ci-required-registration.js';
import { isVerifyWorkflowFile } from './lib/ci-required.js';
import { ROOT_DIR } from './lib/utils.js';

// Registration barrier step of .github/workflows/ci-required.yaml.
//
// Collects what ./lib/ci-required-registration.ts decides on: the enabled verify workflows of the
// checked-out default branch, the open pull requests whose head is the evaluated commit with their
// changed files, and every workflow run on that commit. Writes the decision to GITHUB_OUTPUT for the
// step that publishes the `ci-required` status. Reads only; it publishes nothing itself.

const API_URL = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const API_VERSION = '2022-11-28';
const PAGE_SIZE = 100;
const WORKFLOWS_DIR = '.github/workflows';

interface RawPullRequest {
  number: number;
  head: { sha: string };
  base: { ref: string };
}

/** What the step is told about the evaluated commit, from the `workflow_run` event. */
export interface RegistrationContext {
  repository: string;
  sha: string;
  event: string;
  headOwner: string;
  headBranch: string;
}

/** The REST reads the barrier needs. */
export interface RegistrationApi {
  get<T>(endpoint: string): Promise<T>;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

/** A read-only REST client over `fetch`, for the same reason as in rerun-rate-limited.ts. */
export function restApi(token: string): RegistrationApi {
  return {
    async get<T>(endpoint: string): Promise<T> {
      const response = await fetch(`${API_URL}${endpoint}`, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': API_VERSION,
        },
      });
      if (!response.ok) {
        throw new Error(`GET ${endpoint} failed: ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as T;
    },
  };
}

/** Reads list pages until one comes back short, or until `limit` entries are in hand. */
async function readPages<T>(fetchPage: (page: number) => Promise<T[]>, limit = Number.POSITIVE_INFINITY): Promise<T[]> {
  const entries: T[] = [];
  for (let page = 1; entries.length < limit; page++) {
    const batch = await fetchPage(page);
    entries.push(...batch);
    if (batch.length < PAGE_SIZE) {
      break;
    }
  }
  return entries;
}

/** The verify workflows on disk that GitHub reports as enabled, with their `pull_request` filters. */
export async function enabledVerifyWorkflows(
  api: RegistrationApi,
  repository: string,
  rootDir = ROOT_DIR,
): Promise<VerifyWorkflow[]> {
  const listed = await readPages((page) =>
    api
      .get<{ workflows: { path: string; state: string }[] }>(
        `/repos/${repository}/actions/workflows?per_page=${PAGE_SIZE}&page=${page}`,
      )
      .then(({ workflows }) => workflows),
  );
  const enabled = new Set(listed.filter(({ state }) => state === 'active').map(({ path: file }) => file));

  return fs
    .readdirSync(path.join(rootDir, WORKFLOWS_DIR))
    .filter(isVerifyWorkflowFile)
    .map((file) => `${WORKFLOWS_DIR}/${file}`)
    .filter((file) => enabled.has(file))
    .sort()
    .map((file) => ({
      path: file,
      pullRequest: pullRequestFilterOf(file, fs.readFileSync(path.join(rootDir, file), 'utf8')),
    }));
}

/**
 * The open pull requests whose head is the evaluated commit, with their changed files.
 *
 * Looked up by head branch rather than taken from the event: `workflow_run.pull_requests` is empty
 * for a pull request from a fork. Files are read one past {@link PATH_FILTER_FILE_LIMIT}, which is
 * enough to tell that the limit is exceeded.
 */
export async function pullRequestsAt(api: RegistrationApi, context: RegistrationContext): Promise<PullRequestChange[]> {
  const head = encodeURIComponent(`${context.headOwner}:${context.headBranch}`);
  const open = await readPages((page) =>
    api.get<RawPullRequest[]>(
      `/repos/${context.repository}/pulls?state=open&head=${head}&per_page=${PAGE_SIZE}&page=${page}`,
    ),
  );

  return Promise.all(
    open
      .filter((pull) => pull.head.sha === context.sha)
      .map(async (pull) => ({
        number: pull.number,
        baseRef: pull.base.ref,
        files: await readPages(
          (page) =>
            api.get<ChangedFile[]>(
              `/repos/${context.repository}/pulls/${pull.number}/files?per_page=${PAGE_SIZE}&page=${page}`,
            ),
          PATH_FILTER_FILE_LIMIT + 1,
        ),
      })),
  );
}

/** Every workflow run on the evaluated commit. */
export async function runsAt(api: RegistrationApi, context: RegistrationContext): Promise<WorkflowRunSummary[]> {
  return readPages((page) =>
    api
      .get<{ workflow_runs: WorkflowRunSummary[] }>(
        `/repos/${context.repository}/actions/runs?head_sha=${context.sha}&per_page=${PAGE_SIZE}&page=${page}`,
      )
      .then(({ workflow_runs: runs }) => runs.map(({ path: file, status }) => ({ path: file, status }))),
  );
}

export async function collectRegistration(
  api: RegistrationApi,
  context: RegistrationContext,
  rootDir = ROOT_DIR,
): Promise<Registration> {
  const [workflows, pullRequests, runs] = await Promise.all([
    enabledVerifyWorkflows(api, context.repository, rootDir),
    pullRequestsAt(api, context),
    runsAt(api, context),
  ]);

  return evaluateRegistration({ event: context.event, workflows, pullRequests, runs });
}

/** The step outputs the publish step reads, as `GITHUB_OUTPUT` lines. */
export function formatOutputs(registration: Registration): string {
  const names = registration.missing.map((file) => path.basename(file)).join(' ');
  return [
    `scope=${registration.scope}`,
    `applicable=${registration.applicable.length}`,
    `missing=${registration.missing.length}`,
    `missing_workflows=${names}`,
    `unfinished=${registration.unfinished}`,
    `expected=${registration.expected}`,
    '',
  ].join('\n');
}

export async function main(api?: RegistrationApi, rootDir = ROOT_DIR): Promise<Registration> {
  const context: RegistrationContext = {
    repository: requireEnvironment('GITHUB_REPOSITORY'),
    sha: requireEnvironment('HEAD_SHA'),
    event: requireEnvironment('TRIGGER_EVENT'),
    headOwner: requireEnvironment('HEAD_OWNER'),
    headBranch: requireEnvironment('HEAD_BRANCH'),
  };
  if (!/^[0-9a-f]{40}$/.test(context.sha)) {
    throw new Error(`HEAD_SHA '${context.sha}' is not a commit SHA.`);
  }

  const registration = await collectRegistration(api ?? restApi(requireEnvironment('GITHUB_TOKEN')), context, rootDir);

  console.log(`Scope: ${registration.scope}`);
  console.log(`Applicable verify workflows: ${registration.applicable.join(', ') || 'none'}`);
  console.log(`Without a run yet: ${registration.missing.join(', ') || 'none'}`);
  console.log(`Unfinished verify workflow runs: ${registration.unfinished}`);

  fs.appendFileSync(requireEnvironment('GITHUB_OUTPUT'), formatOutputs(registration));
  return registration;
}

if (import.meta.main) {
  await main();
}
