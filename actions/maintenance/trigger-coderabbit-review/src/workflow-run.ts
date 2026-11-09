/**
 * Finds the pull request a `workflow_run` event was started for.
 *
 * A `workflow_run` job always runs the default branch's copy of its workflow, so a pull request
 * cannot rewrite the job that holds the token. That makes it the replacement for
 * `pull_request_target`, which GitHub now blocks by default on public repositories. The job is
 * started by a `pull_request` workflow that does nothing, and this module reads, from the event of
 * the run that finished, which pull request that was.
 *
 * @packageDocumentation
 */
import { readFileSync } from 'node:fs';

import { errorMessage, quoteForLog } from 'actions-util';

import type { PullRequestCoordinates } from 'actions-util';

/** Why the triggering run is not one this action acts on. */
export type WorkflowRunSkipReason = 'not-pull-request' | 'fork' | 'no-pull-request';

/** The pull request a run was started for, and the commit it ran on. */
export interface WorkflowRunPullRequest {
  /** Base branch the pull request was required to target, or empty for any. */
  baseBranch: string;
  pullRequest: PullRequestCoordinates;
  /** The head commit the triggering run ran on; a pull request that has moved since is skipped. */
  headSha: string;
}

export type WorkflowRunResolution =
  | { kind: 'pull-request'; target: WorkflowRunPullRequest }
  | { kind: 'skip'; reason: WorkflowRunSkipReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Resolves the pull request of a `workflow_run` event payload.
 *
 * Only a run started by a `pull_request` event from a branch of `repository` itself is acted on. A
 * fork's run is skipped before any pull request is looked at, and `workflow_run.pull_requests` is
 * empty for a fork anyway. Of the listed pull requests, only those into `repository` whose head is
 * the commit the run ran on count; with `baseBranch` set, only those into that branch. Two pull
 * requests from the same branch into the same base cannot exist, so the lowest number is taken when
 * more than one is left.
 *
 * @param payload - the parsed event payload.
 * @param repository - `owner/repo` the workflow runs in.
 * @param baseBranch - base branch a pull request must target; empty means the default branch from the payload.
 * @throws if `repository` is not `owner/repo`.
 * @throws if the payload is not a `workflow_run` event.
 */
export function resolveWorkflowRun(payload: unknown, repository: string, baseBranch: string): WorkflowRunResolution {
  const [owner = '', repo = '', ...rest] = repository.split('/');
  if (owner === '' || repo === '' || rest.length > 0) {
    throw new Error(`GITHUB_REPOSITORY must be owner/repo, got ${JSON.stringify(repository)}.`);
  }

  const run = record(record(payload)['workflow_run']);
  const headSha = text(run['head_sha']);

  if (headSha === '') {
    throw new Error('The event payload carries no workflow_run.head_sha; is this a workflow_run event?');
  }
  if (text(run['event']) !== 'pull_request') {
    return { kind: 'skip', reason: 'not-pull-request' };
  }
  if (text(record(run['head_repository'])['full_name']).toLowerCase() !== repository.toLowerCase()) {
    return { kind: 'skip', reason: 'fork' };
  }

  const payloadRepository = record(record(payload)['repository']);
  const repositoryId = payloadRepository['id'];
  const requiredBase = baseBranch === '' ? text(payloadRepository['default_branch']) : baseBranch;
  const numbers = (Array.isArray(run['pull_requests']) ? run['pull_requests'] : [])
    .map(record)
    .filter((candidate) => {
      const base = record(candidate['base']);
      const baseRepoId = record(base['repo'])['id'];

      return (
        typeof baseRepoId === 'number' &&
        baseRepoId === repositoryId &&
        text(record(candidate['head'])['sha']) === headSha &&
        (requiredBase === '' || text(base['ref']) === requiredBase)
      );
    })
    .map((candidate) => candidate['number'])
    .filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    .sort((left, right) => left - right);

  const [number] = numbers;
  if (number === undefined) {
    return { kind: 'skip', reason: 'no-pull-request' };
  }

  return { kind: 'pull-request', target: { baseBranch: requiredBase, headSha, pullRequest: { number, owner, repo } } };
}

/**
 * Reads and parses the event payload the runner wrote.
 *
 * @throws if the file cannot be read or is not JSON.
 */
export function readEventPayload(eventPath: string): unknown {
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read the event payload at ${quoteForLog(eventPath)}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}
