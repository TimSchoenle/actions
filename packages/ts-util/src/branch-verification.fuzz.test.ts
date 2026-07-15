import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { matchesBranchPattern, verifyBranch } from './branch-verification.js';

/** Characters that are legal in a git branch name and carry no regex meaning. */
const branchName = fc.stringMatching(/^[\w./-]{1,60}$/);
const repoName = fc.stringMatching(/^[\w-]{1,20}\/[\w-]{1,20}$/);

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`);
}

describe('matchesBranchPattern fuzzing', () => {
  it('matches a branch against the escaped literal of itself', () => {
    fc.assert(
      fc.property(branchName, (branch) => {
        expect(matchesBranchPattern(`^${escapeRegex(branch)}$`, branch)).toBe(true);
      }),
    );
  });

  it('is unanchored, so any substring pattern matches', () => {
    fc.assert(
      fc.property(branchName, fc.nat(), fc.nat(), (branch, start, length) => {
        const from = start % branch.length;
        const substring = branch.slice(from, from + (length % branch.length) + 1);

        expect(matchesBranchPattern(escapeRegex(substring), branch)).toBe(true);
      }),
    );
  });
});

describe('verifyBranch fuzzing', () => {
  it('holds the invariants: verified = pattern && fork, fork = repo inequality', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(''), fc.constant('^feature/.*'), fc.constant('.*'), fc.constant('^main$')),
        branchName,
        repoName,
        repoName,
        fc.boolean(),
        (branchPattern, headRef, headRepoFullName, baseRepoFullName, rejectForks) => {
          const result = verifyBranch({
            baseRepoFullName,
            branchPattern,
            headRef,
            headRepoFullName,
            rejectForks,
          });

          expect(result.isFork).toBe(headRepoFullName !== baseRepoFullName);
          expect(result.forkVerified).toBe(!(result.isFork && rejectForks));
          expect(result.verified).toBe(result.branchPatternVerified && result.forkVerified);

          if (branchPattern === '') {
            expect(result.branchPatternVerified).toBe(true);
          }
        },
      ),
    );
  });

  it('never reports verified for a rejected fork', () => {
    fc.assert(
      fc.property(repoName, repoName, (headRepoFullName, baseRepoFullName) => {
        fc.pre(headRepoFullName !== baseRepoFullName);

        const result = verifyBranch({
          baseRepoFullName,
          branchPattern: '.*',
          headRef: 'anything',
          headRepoFullName,
          rejectForks: true,
        });

        expect(result.verified).toBe(false);
      }),
    );
  });
});
