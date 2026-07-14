import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseUserIds, validateCommit, verifyCommits } from './verify.js';

import type { CommitRecord } from './verify.js';

const userId = fc.integer({ max: 100_000_000, min: 1 });
const oid = fc.stringMatching(/^[\da-f]{7,40}$/);

const commitRecord = (authorIdPool: fc.Arbitrary<number | null>): fc.Arbitrary<CommitRecord> =>
  fc.record({
    authorIds: fc.array(authorIdPool, { maxLength: 5, minLength: 0 }),
    authorsTruncated: fc.boolean(),
    oid,
    signatureState: fc.oneof(fc.constant(null), fc.constantFrom('VALID', 'INVALID', 'UNSIGNED')),
    signatureValid: fc.boolean(),
  });

describe('parseUserIds fuzzing', () => {
  it('round-trips any list of positive integers', () => {
    fc.assert(
      fc.property(fc.uniqueArray(userId, { maxLength: 10, minLength: 1 }), (ids) => {
        expect(parseUserIds(ids.join(', '))).toEqual(ids);
      }),
    );
  });

  it('either returns positive safe integers or throws — never NaN', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        let ids: number[];

        try {
          ids = parseUserIds(input);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          return;
        }

        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) {
          expect(Number.isSafeInteger(id)).toBe(true);
          expect(id).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('never returns duplicates', () => {
    fc.assert(
      fc.property(fc.array(userId, { maxLength: 20, minLength: 1 }), (ids) => {
        const parsed = parseUserIds(ids.join(','));

        expect(parsed).toEqual([...new Set(parsed)]);
      }),
    );
  });
});

describe('validateCommit fuzzing', () => {
  it('accepts a commit exactly when it is signed and every author is accepted', () => {
    fc.assert(
      fc.property(
        commitRecord(fc.oneof(userId, fc.constant(null))),
        fc.uniqueArray(userId, { maxLength: 5, minLength: 1 }),
        (commit, acceptedIds) => {
          const accepted = new Set(acceptedIds);
          const authorsOk =
            !commit.authorsTruncated &&
            commit.authorIds.length > 0 &&
            commit.authorIds.every((id) => id !== null && accepted.has(id));

          const failure = validateCommit(commit, accepted);

          expect(failure === undefined).toBe(authorsOk && commit.signatureValid);
        },
      ),
    );
  });

  it('never accepts a commit with an unsigned or invalid signature', () => {
    fc.assert(
      fc.property(commitRecord(userId), fc.uniqueArray(userId, { minLength: 1 }), (commit, acceptedIds) => {
        const unsigned = { ...commit, signatureValid: false };

        expect(validateCommit(unsigned, new Set(acceptedIds))).toBeDefined();
      }),
    );
  });

  it('never accepts a commit whose author list was truncated', () => {
    fc.assert(
      fc.property(commitRecord(userId), fc.uniqueArray(userId, { minLength: 1 }), (commit, acceptedIds) => {
        const truncated = { ...commit, authorsTruncated: true };

        expect(validateCommit(truncated, new Set(acceptedIds))).toBeDefined();
      }),
    );
  });

  it('always reports at least one reason for a rejected commit', () => {
    fc.assert(
      fc.property(commitRecord(fc.oneof(userId, fc.constant(null))), fc.array(userId), (commit, acceptedIds) => {
        const failure = validateCommit(commit, new Set(acceptedIds));

        if (failure) {
          expect(failure.oid).toBe(commit.oid);
          expect(failure.reasons.length).toBeGreaterThan(0);
        }
      }),
    );
  });
});

describe('verifyCommits fuzzing', () => {
  it('verifies only when every commit passes, and lists exactly the failing SHAs', () => {
    fc.assert(
      fc.property(
        fc.array(commitRecord(fc.oneof(userId, fc.constant(null))), { maxLength: 10 }),
        fc.uniqueArray(userId, { maxLength: 5, minLength: 1 }),
        (commits, acceptedIds) => {
          const result = verifyCommits(commits, acceptedIds);
          const accepted = new Set(acceptedIds);
          const expectedFailures = commits.filter((commit) => validateCommit(commit, accepted) !== undefined);

          expect(result.verified).toBe(commits.length > 0 && expectedFailures.length === 0);
          expect(result.invalidCommits).toEqual(expectedFailures.map((commit) => commit.oid));
        },
      ),
    );
  });

  it('never verifies when the accepted set is empty', () => {
    fc.assert(
      fc.property(fc.array(commitRecord(userId), { maxLength: 10 }), (commits) => {
        expect(verifyCommits(commits, []).verified).toBe(false);
      }),
    );
  });

  it('never verifies a commit authored by someone outside the accepted set', () => {
    fc.assert(
      fc.property(
        commitRecord(userId),
        fc.uniqueArray(userId, { minLength: 1 }),
        userId,
        (commit, acceptedIds, intruder) => {
          fc.pre(!acceptedIds.includes(intruder));

          const withIntruder = { ...commit, authorIds: [...commit.authorIds, intruder] };

          expect(verifyCommits([withIntruder], acceptedIds).verified).toBe(false);
        },
      ),
    );
  });
});
