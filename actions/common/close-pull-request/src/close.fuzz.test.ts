import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { parseRepository } from 'actions-common-ts-util';
import { closePullRequestIfPresent, parsePullRequestId } from './close.js';

import type { PullRequestApi } from './close.js';

const segment = fc.stringMatching(/^[\w.-]{1,30}$/);
const pullRequestNumber = fc.integer({ max: 1_000_000, min: 1 });

function fakeApi(exists: boolean): PullRequestApi {
  return {
    closePullRequest: vi.fn(async () => undefined),
    commentOnPullRequest: vi.fn(async () => undefined),
    pullRequestExists: vi.fn(async () => exists),
  };
}

describe('parseRepository fuzzing', () => {
  it('round-trips any well-formed owner/repo pair', () => {
    fc.assert(
      fc.property(segment, segment, (owner, repo) => {
        expect(parseRepository(`${owner}/${repo}`)).toEqual({ owner, repo });
      }),
    );
  });

  it('rejects anything that is not exactly two slash-separated segments', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const isWellFormed = /^[^\s/]+\/[^\s/]+$/.test(value);

        if (isWellFormed) {
          expect(() => parseRepository(value)).not.toThrow();
          return;
        }

        expect(() => parseRepository(value)).toThrow(/Invalid repository/);
      }),
    );
  });
});

describe('parsePullRequestId fuzzing', () => {
  it('accepts every positive integer', () => {
    fc.assert(
      fc.property(pullRequestNumber, (value) => {
        expect(parsePullRequestId(String(value))).toBe(value);
      }),
    );
  });

  it('never returns a number for anything that is not a positive decimal integer', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const isPositiveInteger = /^\d+$/.test(value) && Number(value) > 0;

        if (isPositiveInteger) {
          expect(parsePullRequestId(value)).toBeGreaterThan(0);
          return;
        }

        expect(() => parsePullRequestId(value)).toThrow(/Invalid pull_request_id/);
      }),
    );
  });
});

describe('closePullRequestIfPresent fuzzing', () => {
  it('closes exactly the pull request it probed, and comments only when a comment is given', async () => {
    await fc.assert(
      fc.asyncProperty(segment, segment, pullRequestNumber, fc.string(), async (owner, repo, number, comment) => {
        const api = fakeApi(true);

        const result = await closePullRequestIfPresent(api, {
          comment,
          pullRequestId: String(number),
          repository: `${owner}/${repo}`,
        });

        expect(result).toEqual({ closed: true, commented: comment !== '', pullRequestNumber: number });
        expect(api.closePullRequest).toHaveBeenCalledWith({ owner, repo }, number);
        expect(api.commentOnPullRequest).toHaveBeenCalledTimes(comment === '' ? 0 : 1);
      }),
    );
  });

  it('never comments on or closes a pull request that does not exist', async () => {
    await fc.assert(
      fc.asyncProperty(pullRequestNumber, fc.string(), async (number, comment) => {
        const api = fakeApi(false);

        const result = await closePullRequestIfPresent(api, {
          comment,
          pullRequestId: String(number),
          repository: 'owner/repo',
        });

        expect(result).toEqual({ closed: false, commented: false, pullRequestNumber: number });
        expect(api.commentOnPullRequest).not.toHaveBeenCalled();
        expect(api.closePullRequest).not.toHaveBeenCalled();
      }),
    );
  });
});
