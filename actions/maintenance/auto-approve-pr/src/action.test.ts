import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { AutoApproveApi, PullRequestInfo } from './github-api.js';
import type { CommitRecord } from 'actions-util';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  auto_approve_message: 'Auto-approved by workflow.',
  branch_pattern: '^release-please--branches--.*$',
  ignore_empty_prs: 'true',
  pr_url: 'https://github.com/owner/repo/pull/1',
  reject_forks: 'true',
  token: 'ghs_token',
  user_ids: '12345',
};

function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

const validPr: PullRequestInfo = {
  authorId: 12345,
  baseRepoFullName: 'owner/repo',
  changedFiles: 2,
  headRef: 'release-please--branches--main',
  headRepoFullName: 'owner/repo',
};

const signedCommit: CommitRecord = {
  authorIds: [12345],
  oid: 'abc1234',
  signatureState: 'VALID',
  signatureValid: true,
};

function fakeApi(info: PullRequestInfo = validPr): AutoApproveApi & { approve: ReturnType<typeof vi.fn> } {
  return {
    approve: vi.fn(async () => {}),
    fetchCommits: vi.fn(async () => ({ commits: [signedCommit], totalCount: 1 })),
    getPullRequest: vi.fn(async () => info),
  };
}

describe('auto-approve-pr action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('approves a qualifying pull request', async () => {
    const api = fakeApi();

    await run(api);

    expect(api.approve).toHaveBeenCalledWith({ number: 1, owner: 'owner', repo: 'repo' }, 'Auto-approved by workflow.');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('does not approve or fail when a check does not pass', async () => {
    const api = fakeApi({ ...validPr, authorId: 99999 });

    await run(api);

    expect(api.approve).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails when a required input is missing', async () => {
    setInputs({ user_ids: '' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith('Input required and not supplied: user_ids');
  });

  it('fails with a clear message when the pull request URL cannot be parsed', async () => {
    setInputs({ pr_url: 'not-a-url' });
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid pull request URL'));
    expect(api.approve).not.toHaveBeenCalled();
  });

  it('fails with the API error when a request fails', async () => {
    const api: AutoApproveApi = {
      approve: vi.fn(async () => {}),
      fetchCommits: vi.fn(async () => ({ commits: [signedCommit], totalCount: 1 })),
      getPullRequest: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
    };

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith('Bad credentials');
  });
});
