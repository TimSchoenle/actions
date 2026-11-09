import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readEventPayload, resolveWorkflowRun } from './workflow-run.js';

const HEAD = 'a'.repeat(40);
const REPOSITORY_ID = 42;

function pullRequest(
  number: number,
  overrides: { sha?: string; ref?: string; repoId?: number; headRef?: string } = {},
) {
  return {
    base: { ref: overrides.ref ?? 'main', repo: { id: overrides.repoId ?? REPOSITORY_ID, name: 'repo' } },
    head: {
      ref: overrides.headRef ?? 'feature',
      repo: { id: REPOSITORY_ID, name: 'repo' },
      sha: overrides.sha ?? HEAD,
    },
    id: number * 100,
    number,
  };
}

function payload(run: Record<string, unknown> = {}) {
  return {
    repository: { default_branch: 'main', full_name: 'owner/repo', id: REPOSITORY_ID },
    workflow_run: {
      event: 'pull_request',
      head_repository: { full_name: 'owner/repo' },
      head_branch: 'feature',
      head_sha: HEAD,
      pull_requests: [pullRequest(7)],
      ...run,
    },
  };
}

describe('resolveWorkflowRun', () => {
  it('resolves the pull request whose head the run ran on', () => {
    expect(resolveWorkflowRun(payload(), 'owner/repo', 'main')).toEqual({
      kind: 'pull-request',
      target: { baseBranch: 'main', headSha: HEAD, pullRequest: { number: 7, owner: 'owner', repo: 'repo' } },
    });
  });

  it('requires the default branch of the repository when no base branch is given', () => {
    expect(resolveWorkflowRun(payload(), 'owner/repo', '')).toMatchObject({
      kind: 'pull-request',
      target: { baseBranch: 'main' },
    });
    expect(
      resolveWorkflowRun(payload({ pull_requests: [pullRequest(9, { ref: 'release' })] }), 'owner/repo', ''),
    ).toEqual({ kind: 'skip', reason: 'no-pull-request' });
  });

  it('accepts any base branch when neither a base branch nor a default branch is known', () => {
    const resolution = resolveWorkflowRun(
      { ...payload({ pull_requests: [pullRequest(9, { ref: 'release' })] }), repository: { id: REPOSITORY_ID } },
      'owner/repo',
      '',
    );

    expect(resolution).toMatchObject({ kind: 'pull-request', target: { baseBranch: '', pullRequest: { number: 9 } } });
  });

  it.each(['', 'owner', 'owner/', '/repo', 'owner/repo/extra'])('refuses the repository %j', (repository) => {
    expect(() => resolveWorkflowRun(payload(), repository, 'main')).toThrow(/GITHUB_REPOSITORY must be owner\/repo/);
  });

  it('compares the repository case-insensitively', () => {
    expect(resolveWorkflowRun(payload(), 'Owner/Repo', 'main')).toMatchObject({ kind: 'pull-request' });
  });

  it.each(['push', 'pull_request_target', 'workflow_dispatch', ''])('skips a run started by %j', (event) => {
    expect(resolveWorkflowRun(payload({ event }), 'owner/repo', 'main')).toEqual({
      kind: 'skip',
      reason: 'not-pull-request',
    });
  });

  it.each([
    { description: 'a fork', headRepository: { full_name: 'someone/repo' } },
    { description: 'a deleted fork', headRepository: null },
  ])('skips a run from $description before looking at pull requests', ({ headRepository }) => {
    expect(resolveWorkflowRun(payload({ head_repository: headRepository }), 'owner/repo', 'main')).toEqual({
      kind: 'skip',
      reason: 'fork',
    });
  });

  it.each([
    { description: 'no pull request', pullRequests: [] },
    { description: 'a missing list', pullRequests: undefined },
    { description: 'a pull request whose head has moved', pullRequests: [pullRequest(7, { sha: 'b'.repeat(40) })] },
    { description: 'a pull request into another repository', pullRequests: [pullRequest(7, { repoId: 99 })] },
    { description: 'a pull request into another base branch', pullRequests: [pullRequest(7, { ref: 'release' })] },
    {
      description: 'a pull request from another branch on the same commit',
      pullRequests: [pullRequest(7, { headRef: 'other' })],
    },
    { description: 'a malformed entry', pullRequests: ['7', null, { number: '7' }] },
  ])('skips a run with $description', ({ pullRequests }) => {
    expect(resolveWorkflowRun(payload({ pull_requests: pullRequests }), 'owner/repo', 'main')).toEqual({
      kind: 'skip',
      reason: 'no-pull-request',
    });
  });

  it('takes the lowest number when several pull requests match', () => {
    const resolution = resolveWorkflowRun(
      payload({ pull_requests: [pullRequest(12), pullRequest(5, { ref: 'release' }), pullRequest(8)] }),
      'owner/repo',
      'main',
    );

    expect(resolution).toMatchObject({ kind: 'pull-request', target: { pullRequest: { number: 8 } } });
  });

  it('refuses a payload that is not a workflow_run event', () => {
    expect(() => resolveWorkflowRun({ pull_request: { number: 7 } }, 'owner/repo', 'main')).toThrow(
      /no workflow_run\.head_sha/,
    );
  });
});

describe('readEventPayload', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'coderabbit-event-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('parses the event file', async () => {
    const file = path.join(root, 'event.json');
    await writeFile(file, JSON.stringify(payload()));

    expect(readEventPayload(file)).toEqual(payload());
  });

  it.each([
    { content: undefined, description: 'a missing file' },
    { content: '{not json', description: 'a file that is not JSON' },
  ])('fails on $description', async ({ content }) => {
    const file = path.join(root, 'event.json');
    if (content !== undefined) {
      await writeFile(file, content);
    }

    expect(() => readEventPayload(file)).toThrow(/Could not read the event payload/);
  });
});
