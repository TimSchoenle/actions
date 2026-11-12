import { describe, expect, it, vi } from 'vitest';

import {
  checkRunsLookup,
  GITHUB_ACTIONS_APP_ID,
  pullRequestNumber,
  verifiedMergedHead,
  VERIFY_CHECK_NAME,
} from '../merged-head.js';
import { SUMMARY_JOB_NAME } from '../render.js';

import type { CheckRun } from '../merged-head.js';

const FROM = 'a'.repeat(40);
const TO = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const TREE = 'd'.repeat(40);
const SUCCESS: CheckRun = { status: 'completed', conclusion: 'success' };

describe('pullRequestNumber', () => {
  it('reads the number a squash subject ends with', () => {
    expect(pullRequestNumber('fix(ts-util): retry (#2170)')).toBe(2170);
    expect(pullRequestNumber('fix: x (#12)  ')).toBe(12);
  });

  it('ignores a reference that is not at the end, or is not a number', () => {
    expect(pullRequestNumber('revert (#12) partly')).toBeUndefined();
    expect(pullRequestNumber('fix: x (#0)')).toBeUndefined();
    expect(pullRequestNumber('fix: x (#abc)')).toBeUndefined();
    expect(pullRequestNumber('fix: x #12')).toBeUndefined();
  });
});

/** A git that answers the queries `verifiedMergedHead` makes, from the values given. */
function fakeGit(answers: { subject?: string; headTree?: string; mergeBase?: string; fetch?: () => void }) {
  return (args: readonly string[]): string => {
    switch (args.join(' ')) {
      case `log -1 --format=%s ${TO}`: {
        return `${answers.subject ?? 'Change (#7)'}\n`;
      }
      case 'fetch --no-tags --quiet origin refs/pull/7/head': {
        answers.fetch?.();
        return '';
      }
      case 'rev-parse --verify FETCH_HEAD^{commit}': {
        return `${HEAD}\n`;
      }
      case `rev-parse --verify ${HEAD}^{tree}`: {
        return `${answers.headTree ?? TREE}\n`;
      }
      case `rev-parse --verify ${TO}^{tree}`: {
        return `${TREE}\n`;
      }
      case `merge-base ${FROM} ${HEAD}`: {
        return `${answers.mergeBase ?? FROM}\n`;
      }
      default: {
        throw new Error(`unexpected git ${args.join(' ')}`);
      }
    }
  };
}

const PUSH = { from: FROM, to: TO };

describe('verifiedMergedHead', () => {
  it('verifies a head with the pushed tree, the previous commit and a successful check', async () => {
    const lookup = vi.fn(async () => [SUCCESS]);

    await expect(verifiedMergedHead(fakeGit({}), lookup, PUSH)).resolves.toEqual({ verified: true, pullRequest: 7 });
    expect(lookup).toHaveBeenCalledWith(HEAD);
  });

  it.each([
    ['names no pull request', { subject: 'direct push' }, 'the pushed commit names no pull request'],
    ['has another tree', { headTree: 'e'.repeat(40) }, 'the pushed tree differs from the head of #7'],
    [
      'lacks the previous commit',
      { mergeBase: 'f'.repeat(40) },
      'the head of #7 does not contain the previous commit on main',
    ],
  ])('does not verify a push whose head %s', async (_name, answers, reason) => {
    const lookup = vi.fn(async () => [SUCCESS]);

    await expect(verifiedMergedHead(fakeGit(answers), lookup, PUSH)).resolves.toEqual({ verified: false, reason });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not verify when git cannot fetch the head', async () => {
    const git = fakeGit({
      fetch: () => {
        throw new Error("fatal: couldn't find remote ref refs/pull/7/head\nmore");
      },
    });

    await expect(verifiedMergedHead(git, async () => [SUCCESS], PUSH)).resolves.toEqual({
      verified: false,
      reason: "git could not read the pull request head (fatal: couldn't find remote ref refs/pull/7/head)",
    });
  });

  it.each([
    ['no check', [], 'the head of #7 has no Verify check'],
    ['a failed check', [{ status: 'completed', conclusion: 'failure' }], 'Verify did not succeed on the head of #7'],
    ['a running check', [{ status: 'in_progress', conclusion: null }], 'Verify did not succeed on the head of #7'],
    [
      'one failure among successes',
      [SUCCESS, { status: 'completed', conclusion: 'cancelled' }],
      'Verify did not succeed on the head of #7',
    ],
  ])('does not verify a head with %s', async (_name, runs: readonly CheckRun[], reason) => {
    await expect(verifiedMergedHead(fakeGit({}), async () => runs, PUSH)).resolves.toEqual({ verified: false, reason });
  });

  it('does not verify when the check cannot be read', async () => {
    const lookup = async (): Promise<readonly CheckRun[]> => {
      throw new Error('the check-runs request returned 403');
    };

    await expect(verifiedMergedHead(fakeGit({}), lookup, PUSH)).resolves.toEqual({
      verified: false,
      reason: 'the Verify check of #7 could not be read (the check-runs request returned 403)',
    });
  });
});

describe('checkRunsLookup', () => {
  const options = { apiUrl: 'https://api.example.test', repository: 'owner/repo', token: 'secret' };

  it('asks for the latest Verify runs of GitHub Actions on the commit, with the token', async () => {
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) =>
      Response.json({
        check_runs: [{ status: 'completed', conclusion: 'success', name: 'Verify' }, { status: 'queued' }],
      }),
    );

    const runs = await checkRunsLookup({ ...options, fetch: fetch as unknown as typeof globalThis.fetch })(HEAD);

    expect(runs).toEqual([SUCCESS, { status: 'queued', conclusion: null }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url.origin + url.pathname).toBe(`https://api.example.test/repos/owner/repo/commits/${HEAD}/check-runs`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      check_name: VERIFY_CHECK_NAME,
      app_id: String(GITHUB_ACTIONS_APP_ID),
      filter: 'latest',
      per_page: '100',
    });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws for a response that is not a success or not a check-runs list', async () => {
    const respond = (response: Response) =>
      checkRunsLookup({ ...options, fetch: (async () => response) as unknown as typeof globalThis.fetch })(HEAD);

    await expect(respond(new Response('', { status: 404 }))).rejects.toThrow('returned 404');
    await expect(respond(Response.json({ message: 'x' }))).rejects.toThrow('no check_runs array');
  });

  it('looks up the check the summary job reports', () => {
    expect(VERIFY_CHECK_NAME).toBe(SUMMARY_JOB_NAME);
  });
});
