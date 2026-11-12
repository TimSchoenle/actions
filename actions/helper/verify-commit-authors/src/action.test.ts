import * as core from 'actions-util/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { CommitRecord } from 'actions-util';
import type { PullRequestCommits } from 'actions-util/commits';

vi.mock('actions-util/core');

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  github_token: 'ghs_test_token',
  pr_url: 'https://github.com/owner/repo/pull/1',
  reject_forks: 'true',
  user_ids: '12345, 67890',
};

function mockInputs(overrides: Inputs = {}): void {
  const inputs: Inputs = { ...defaultInputs, ...overrides };
  vi.mocked(core.getInput).mockImplementation((name: string) => inputs[name] ?? '');
  vi.mocked(core.getBooleanInput).mockImplementation((name: string) => {
    const value = inputs[name] ?? '';
    if (value !== 'true' && value !== 'false') {
      throw new TypeError(`Input does not meet YAML 1.2 "Core Schema" specification: ${name}`);
    }
    return value === 'true';
  });
}

function commit(overrides: Partial<CommitRecord> = {}): CommitRecord {
  return {
    authorIds: [12345],
    committedDate: '2026-11-01T00:00:00Z',
    committerId: 12345,
    oid: 'abc1234',
    signatureState: 'VALID',
    signatureValid: true,
    signedByGitHub: false,
    signerId: 12345,
    ...overrides,
  };
}

/** A pull request whose head lives in the base repository, read at `abc1234`. */
function sameRepository(commits: CommitRecord[]): PullRequestCommits {
  return {
    commits,
    headOid: 'abc1234',
    headRepository: 'owner/repo',
    isCrossRepository: false,
    totalCount: commits.length,
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
    await run(
      fetcher({
        commits: [commit()],
        headOid: 'abc1234',
        headRepository: 'owner/repo',
        isCrossRepository: false,
        totalCount: 1,
      }),
    );

    expect(outputs()).toEqual({ head_sha: 'abc1234', invalid_commits: '', verified: 'true' });
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith('All 1 commit(s) verified at abc1234.');
  });

  it('passes the token and URL to the fetcher', async () => {
    const fetchCommits = fetcher({
      commits: [commit()],
      headOid: 'abc1234',
      headRepository: 'owner/repo',
      isCrossRepository: false,
      totalCount: 1,
    });

    await run(fetchCommits);

    expect(fetchCommits).toHaveBeenCalledWith('ghs_test_token', 'https://github.com/owner/repo/pull/1');
  });

  it('reports every invalid commit on the invalid_commits output', async () => {
    const commits = [
      commit({ authorIds: [99999], oid: 'bad1' }),
      commit({ oid: 'bad2', signatureState: 'UNSIGNED', signatureValid: false }),
    ];

    await run(
      fetcher({ commits, headOid: 'abc1234', headRepository: 'owner/repo', isCrossRepository: false, totalCount: 2 }),
    );

    expect(outputs()).toEqual({ head_sha: 'abc1234', invalid_commits: 'bad1\nbad2', verified: 'false' });
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('bad1'));
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('bad2'));
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Found 2 invalid commit(s)'));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('rejects an accepted author forged onto a commit signed with a foreign key, naming the signer', async () => {
    await run(
      fetcher({
        commits: [commit({ committerId: 99999, signerId: 99999 })],
        headOid: 'abc1234',
        headRepository: 'owner/repo',
        isCrossRepository: false,
        totalCount: 1,
      }),
    );

    expect(outputs()).toEqual({ head_sha: 'abc1234', invalid_commits: 'abc1234', verified: 'false' });
    expect(core.error).toHaveBeenCalledWith(
      'Invalid commit abc1234: committer not accepted: 99999; signer not accepted: 99999.',
    );
  });

  it('refuses to verify a pull request without commits', async () => {
    await run(
      fetcher({
        commits: [],
        headOid: 'abc1234',
        headRepository: 'owner/repo',
        isCrossRepository: false,
        totalCount: 0,
      }),
    );

    expect(outputs()).toEqual({ head_sha: 'abc1234', invalid_commits: '', verified: 'false' });
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('no commits'));
  });

  it('reports a pull request from a fork as unverified, however its commits look', async () => {
    await run(fetcher({ ...sameRepository([commit()]), headRepository: 'fork/repo', isCrossRepository: true }));

    expect(outputs()).toEqual({ head_sha: 'abc1234', invalid_commits: '', verified: 'false' });
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('"fork/repo"'));
  });

  // GitHub reports no head repository once the fork is deleted. Where the commits came from is then
  // unknown, so the pull request is treated as a fork.
  it('reports a pull request whose head repository is gone as unverified', async () => {
    await run(fetcher({ ...sameRepository([commit()]), headRepository: null, isCrossRepository: true }));

    expect(outputs()).toEqual({ head_sha: 'abc1234', invalid_commits: '', verified: 'false' });
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('no longer exists'));
  });

  it('still lists the invalid commits of a rejected fork pull request', async () => {
    await run(
      fetcher({
        ...sameRepository([commit({ authorIds: [99999], oid: 'bad1' })]),
        headRepository: 'fork/repo',
        isCrossRepository: true,
      }),
    );

    expect(outputs()).toEqual({ head_sha: 'abc1234', invalid_commits: 'bad1', verified: 'false' });
  });

  it('verifies a pull request from a fork when reject_forks is false', async () => {
    mockInputs({ reject_forks: 'false' });

    await run(fetcher({ ...sameRepository([commit()]), headRepository: 'fork/repo', isCrossRepository: true }));

    expect(outputs()).toEqual({ head_sha: 'abc1234', invalid_commits: '', verified: 'true' });
  });

  it('fails the step on a reject_forks value that is not a boolean', async () => {
    mockInputs({ reject_forks: 'yes' });

    await run(fetcher(sameRepository([commit()])));

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('reject_forks'));
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails the step on an invalid user ID rather than reporting an unverified pull request', async () => {
    mockInputs({ user_ids: '12345, not-an-id' });

    await run(
      fetcher({
        commits: [commit()],
        headOid: 'abc1234',
        headRepository: 'owner/repo',
        isCrossRepository: false,
        totalCount: 1,
      }),
    );

    expect(core.setFailed).toHaveBeenCalledWith(
      "Invalid user ID 'not-an-id'. Expected a positive integer GitHub user database ID.",
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails the step when no user ID is provided', async () => {
    mockInputs({ user_ids: ' , ' });

    await run(
      fetcher({
        commits: [commit()],
        headOid: 'abc1234',
        headRepository: 'owner/repo',
        isCrossRepository: false,
        totalCount: 1,
      }),
    );

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
    await run(
      fetcher({
        commits: [commit()],
        headOid: 'abc1234',
        headRepository: 'owner/repo',
        isCrossRepository: false,
        totalCount: 1,
      }),
    );

    expect(core.info).toHaveBeenCalledWith('Verifying commits for PR: "https://github.com/owner/repo/pull/1"');
    expect(core.info).toHaveBeenCalledWith('Accepted User IDs: 12345, 67890');
  });
});
