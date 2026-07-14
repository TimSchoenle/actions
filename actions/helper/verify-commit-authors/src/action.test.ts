import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { PullRequestCommits } from './github-api.js';
import type { CommitRecord } from './verify.js';

vi.mock('@actions/core');

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  github_token: 'ghs_test_token',
  pr_url: 'https://github.com/owner/repo/pull/1',
  user_ids: '12345, 67890',
};

function mockInputs(overrides: Inputs = {}): void {
  const inputs: Inputs = { ...defaultInputs, ...overrides };
  vi.mocked(core.getInput).mockImplementation((name: string) => inputs[name] ?? '');
}

function commit(overrides: Partial<CommitRecord> = {}): CommitRecord {
  return {
    authorIds: [12345],
    authorsTruncated: false,
    oid: 'abc1234',
    signatureState: 'VALID',
    signatureValid: true,
    ...overrides,
  };
}

function fetcher(result: PullRequestCommits): (token: string, prUrl: string) => Promise<PullRequestCommits> {
  return vi.fn(async () => result);
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls as [string, string][]);
}

describe('verify-commit-authors action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInputs();
  });

  it('verifies a pull request whose commits all pass', async () => {
    await run(fetcher({ commits: [commit()], totalCount: 1 }));

    expect(outputs()).toEqual({ invalid_commits: '', verified: 'true' });
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith('All 1 commit(s) verified.');
  });

  it('passes the token and URL to the fetcher', async () => {
    const fetchCommits = fetcher({ commits: [commit()], totalCount: 1 });

    await run(fetchCommits);

    expect(fetchCommits).toHaveBeenCalledWith('ghs_test_token', 'https://github.com/owner/repo/pull/1');
  });

  it('reports every invalid commit on the invalid_commits output', async () => {
    const commits = [
      commit({ authorIds: [99999], oid: 'bad1' }),
      commit({ oid: 'bad2', signatureState: 'UNSIGNED', signatureValid: false }),
    ];

    await run(fetcher({ commits, totalCount: 2 }));

    expect(outputs()).toEqual({ invalid_commits: 'bad1\nbad2', verified: 'false' });
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('bad1'));
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('bad2'));
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Found 2 invalid commit(s)'));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('refuses to verify a pull request with more commits than one page', async () => {
    await run(fetcher({ commits: [commit()], totalCount: 101 }));

    expect(outputs()).toEqual({ invalid_commits: '', verified: 'false' });
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('more than the 100 this action can verify'));
  });

  it('refuses to verify a pull request without commits', async () => {
    await run(fetcher({ commits: [], totalCount: 0 }));

    expect(outputs()).toEqual({ invalid_commits: '', verified: 'false' });
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('no commits'));
  });

  it('fails the step on an invalid user ID rather than reporting an unverified pull request', async () => {
    mockInputs({ user_ids: '12345, not-an-id' });

    await run(fetcher({ commits: [commit()], totalCount: 1 }));

    expect(core.setFailed).toHaveBeenCalledWith(
      "Invalid user ID 'not-an-id'. Expected a positive integer GitHub user database ID.",
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails the step when no user ID is provided', async () => {
    mockInputs({ user_ids: ' , ' });

    await run(fetcher({ commits: [commit()], totalCount: 1 }));

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('at least one user database ID'));
  });

  it('fails the step on an API error', async () => {
    await run(async () => {
      throw new Error('API Down');
    });

    expect(core.setFailed).toHaveBeenCalledWith('API Down');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails the step on a thrown non-Error value, keeping its message', async () => {
    await run(async () => {
      throw 'string error';
    });

    expect(core.setFailed).toHaveBeenCalledWith('string error');
  });

  it('logs the pull request and the accepted IDs', async () => {
    await run(fetcher({ commits: [commit()], totalCount: 1 }));

    expect(core.info).toHaveBeenCalledWith('Verifying commits for PR: https://github.com/owner/repo/pull/1');
    expect(core.info).toHaveBeenCalledWith('Accepted User IDs: 12345, 67890');
  });
});
