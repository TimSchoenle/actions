import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from 'actions-util/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { createTriggerApi } from './github-api.js';

import type { PullRequestInfo, TriggerApi } from './github-api.js';

/**
 * Only the reporting side of `actions-util/core` is mocked. Input reading stays real so the tests
 * exercise the actual `getInput` semantics, including `required` and boolean parsing.
 */
vi.mock('actions-util/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

// Only the factory is replaced, so a case can run without an injected API and still reach no network.
vi.mock('./github-api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./github-api.js')>()),
  createTriggerApi: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  base_branch: 'main',
  collapse_outdated: 'true',
  command: 'review',
  pr_url: 'https://github.com/owner/repo/pull/7',
  reject_forks: 'true',
  skip_authors: '',
  skip_bots: 'true',
  skip_drafts: 'true',
  skip_duplicates: 'true',
  token: 'github_pat_test',
};

const openPullRequest: PullRequestInfo = {
  authorLogin: 'alice',
  authorType: 'User',
  baseRef: 'main',
  baseRepoFullName: 'owner/repo',
  draft: false,
  headRepoFullName: 'owner/repo',
  headSha: 'a'.repeat(40),
  state: 'open',
};

function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function fakeApi(pullRequest: PullRequestInfo = openPullRequest): TriggerApi {
  return {
    getPullRequest: vi.fn(async () => pullRequest),
    getReviewActivity: vi.fn(async () => ({ comments: [], reviews: [] })),
    getTokenIdentity: vi.fn(async () => ({ login: 'owner-user', type: 'User' })),
    minimizeComment: vi.fn(async () => undefined),
    postComment: vi.fn(async () => ({ id: 1, url: 'https://github.com/owner/repo/pull/7#issuecomment-1' })),
  };
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls.map(([name, value]) => [name, String(value)]));
}

describe('trigger-coderabbit-review action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('posts the command and publishes the comment URL', async () => {
    const api = fakeApi();

    await run(api);

    expect(api.postComment).toHaveBeenCalledWith(
      { number: 7, owner: 'owner', repo: 'repo' },
      `@coderabbitai review\n\n<!-- trigger-coderabbit-review head=${'a'.repeat(40)} -->`,
    );
    expect(outputs()).toEqual({
      collapsed_comments: '0',
      comment_url: 'https://github.com/owner/repo/pull/7#issuecomment-1',
      skip_reason: '',
      triggered: 'true',
    });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('publishes the collapsed count and warns about a comment it could not collapse', async () => {
    const api = fakeApi();
    const ownRequest = {
      authorIsBot: false,
      authorLogin: 'owner-user',
      body: `@coderabbitai review\n\n<!-- trigger-coderabbit-review head=${'b'.repeat(40)} -->`,
      createdAt: '2026-11-09T10:00:00Z',
      updatedAt: '2026-11-09T10:00:00Z',
      isMinimized: false,
    };
    vi.mocked(api.getReviewActivity).mockResolvedValue({
      comments: [
        { ...ownRequest, nodeId: 'IC_1' },
        { ...ownRequest, nodeId: 'IC_2' },
      ],
      reviews: [],
    });
    vi.mocked(api.minimizeComment).mockRejectedValueOnce(new Error('Resource not accessible'));

    await run(api);

    expect(outputs()).toMatchObject({ collapsed_comments: '1', triggered: 'true' });
    expect(core.warning).toHaveBeenCalledWith('Could not collapse an outdated comment: IC_1: Resource not accessible');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('passes skip_duplicates and collapse_outdated through', async () => {
    setInputs({ collapse_outdated: 'false', skip_duplicates: 'false' });
    const api = fakeApi();

    await run(api);

    expect(api.getReviewActivity).not.toHaveBeenCalled();
    expect(outputs()).toMatchObject({ triggered: 'true' });
  });

  it('publishes the skip reason and posts nothing', async () => {
    const api = fakeApi({ ...openPullRequest, authorLogin: 'renovate[bot]', authorType: 'Bot' });

    await run(api);

    expect(api.postComment).not.toHaveBeenCalled();
    expect(outputs()).toEqual({
      collapsed_comments: '0',
      comment_url: '',
      skip_reason: 'bot-author',
      triggered: 'false',
    });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('passes skip_authors through', async () => {
    setInputs({ skip_authors: 'someone,\nAlice' });
    const api = fakeApi();

    await run(api);

    expect(outputs()).toMatchObject({ skip_reason: 'skipped-author', triggered: 'false' });
  });

  it('honours a disabled skip rule', async () => {
    setInputs({ skip_drafts: 'false' });
    const api = fakeApi({ ...openPullRequest, draft: true });

    await run(api);

    expect(outputs()).toMatchObject({ triggered: 'true' });
  });

  it.each([
    ['command', { command: 'resume' }, 'Invalid command'],
    ['pr_url', { pr_url: 'https://github.com/owner/repo/issues/7' }, 'Invalid pull request URL'],
    ['skip_drafts', { skip_drafts: 'maybe' }, 'skip_drafts'],
  ])('fails on an invalid %s before calling the API', async (_input, overrides, message) => {
    setInputs(overrides);
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(api.getTokenIdentity).not.toHaveBeenCalled();
  });

  it('fails when the token is not a user token', async () => {
    const api = { ...fakeApi(), getTokenIdentity: vi.fn(async () => undefined) };

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('CodeRabbit ignores commands'));
    expect(api.postComment).not.toHaveBeenCalled();
    expect(outputs()).toEqual({});
  });

  describe('in a workflow_run job', () => {
    let root: string;

    /** Points the run at a workflow_run event whose run ran on `headSha` for pull request 7. */
    function stubWorkflowRun(run: Record<string, unknown> = {}): void {
      const file = path.join(root, 'event.json');
      writeFileSync(
        file,
        JSON.stringify({
          repository: { id: 42 },
          workflow_run: {
            event: 'pull_request',
            head_repository: { full_name: 'owner/repo' },
            head_branch: 'feature',
            head_sha: 'a'.repeat(40),
            pull_requests: [
              { base: { ref: 'main', repo: { id: 42 } }, head: { ref: 'feature', sha: 'a'.repeat(40) }, number: 7 },
            ],
            ...run,
          },
        }),
      );
      vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_run');
      vi.stubEnv('GITHUB_EVENT_PATH', file);
      vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
      setInputs({ pr_url: '' });
    }

    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), 'coderabbit-action-'));
    });

    afterEach(() => {
      rmSync(root, { force: true, recursive: true });
    });

    it('posts on the pull request the triggering run belongs to', async () => {
      stubWorkflowRun();
      const api = fakeApi();

      await run(api);

      expect(api.getPullRequest).toHaveBeenCalledWith({ number: 7, owner: 'owner', repo: 'repo' });
      expect(api.postComment).toHaveBeenCalledWith(
        { number: 7, owner: 'owner', repo: 'repo' },
        `@coderabbitai review\n\n<!-- trigger-coderabbit-review head=${'a'.repeat(40)} -->`,
      );
      expect(outputs()).toMatchObject({ triggered: 'true' });
    });

    it('skips a pull request whose head moved after the triggering run', async () => {
      stubWorkflowRun();
      const api = fakeApi({ ...openPullRequest, headSha: 'b'.repeat(40) });

      await run(api);

      expect(api.postComment).not.toHaveBeenCalled();
      expect(outputs()).toEqual({
        collapsed_comments: '0',
        comment_url: '',
        skip_reason: 'outdated',
        triggered: 'false',
      });
    });

    it('skips a fork without calling GitHub', async () => {
      stubWorkflowRun({ head_repository: { full_name: 'someone/repo' }, pull_requests: [] });
      const api = fakeApi();

      await run(api);

      expect(api.getTokenIdentity).not.toHaveBeenCalled();
      expect(outputs()).toEqual({ collapsed_comments: '0', comment_url: '', skip_reason: 'fork', triggered: 'false' });
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('still validates the command before reading the event', async () => {
      stubWorkflowRun();
      setInputs({ command: 'resume', pr_url: '' });
      const api = fakeApi();

      await run(api);

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid command'));
      expect(api.getTokenIdentity).not.toHaveBeenCalled();
    });
  });

  it('requires pr_url outside a workflow_run job', async () => {
    vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
    setInputs({ pr_url: '' });
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('pr_url is required outside a workflow_run job'),
    );
    expect(api.getTokenIdentity).not.toHaveBeenCalled();
  });

  it('builds the API from the token when none is injected', async () => {
    vi.mocked(createTriggerApi).mockReturnValue(fakeApi());

    await run();

    expect(createTriggerApi).toHaveBeenCalledWith('github_pat_test');
  });
});
