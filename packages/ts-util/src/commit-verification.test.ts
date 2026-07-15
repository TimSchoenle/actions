import { describe, expect, it } from 'vitest';

import { parseUserIds, validateCommit, verifyCommits } from './commit-verification.js';

import type { CommitRecord } from './commit-verification.js';

const ACCEPTED = [12345, 67890];

function commit(overrides: Partial<CommitRecord> = {}): CommitRecord {
  return {
    authorIds: [12345],
    oid: 'abc1234',
    signatureState: 'VALID',
    signatureValid: true,
    ...overrides,
  };
}

describe('parseUserIds', () => {
  it('parses a comma-separated list, tolerating surrounding whitespace', () => {
    expect(parseUserIds('111, 222,333 ')).toEqual([111, 222, 333]);
  });

  it('parses a single ID', () => {
    expect(parseUserIds('29139614')).toEqual([29139614]);
  });

  it('ignores empty entries from a trailing separator', () => {
    expect(parseUserIds('111,222,')).toEqual([111, 222]);
  });

  it('removes duplicates', () => {
    expect(parseUserIds('111,222,111')).toEqual([111, 222]);
  });

  it.each(['', '   ', ',', ' , '])('rejects the effectively empty input %j', (input) => {
    expect(parseUserIds.bind(null, input)).toThrow(/must contain at least one user database ID/);
  });

  it.each(['abc', '12a', '-1', '1.5', '0', '1e3', '٣'])('rejects the non-integer ID %j', (input) => {
    expect(parseUserIds.bind(null, input)).toThrow(`Invalid user ID '${input}'`);
  });

  it('rejects an ID beyond the safe integer range instead of silently rounding it', () => {
    expect(parseUserIds.bind(null, '9007199254740993')).toThrow(/Invalid user ID/);
  });

  it('reports the offending entry of a mixed list', () => {
    expect(parseUserIds.bind(null, '111,oops,333')).toThrow("Invalid user ID 'oops'");
  });
});

describe('validateCommit', () => {
  const accepted = new Set(ACCEPTED);

  it('accepts a signed commit from an accepted author', () => {
    expect(validateCommit(commit(), accepted)).toBeUndefined();
  });

  it('accepts a co-authored commit when every author is accepted', () => {
    expect(validateCommit(commit({ authorIds: [12345, 67890] }), accepted)).toBeUndefined();
  });

  it('rejects a commit with an author outside the accepted set', () => {
    expect(validateCommit(commit({ authorIds: [99999] }), accepted)).toEqual({
      oid: 'abc1234',
      reasons: ['author(s) not accepted: 99999'],
    });
  });

  it('rejects a commit where only one co-author is not accepted', () => {
    expect(validateCommit(commit({ authorIds: [12345, 99999] }), accepted)?.reasons).toEqual([
      'author(s) not accepted: 99999',
    ]);
  });

  it('rejects a commit whose author has no linked GitHub account', () => {
    expect(validateCommit(commit({ authorIds: [null] }), accepted)?.reasons).toEqual([
      '1 author(s) are not linked to a GitHub account',
    ]);
  });

  it('rejects a commit without any author', () => {
    expect(validateCommit(commit({ authorIds: [] }), accepted)?.reasons).toEqual(['commit has no authors']);
  });

  it.each([
    ['an invalid signature', { signatureState: 'INVALID', signatureValid: false }],
    ['no signature at all', { signatureState: null, signatureValid: false }],
  ])('rejects a commit with %s', (_name, overrides) => {
    const failure = validateCommit(commit(overrides), accepted);

    expect(failure?.reasons).toEqual([expect.stringContaining('signature is not valid')]);
  });

  it('names the signature state in the failure reason', () => {
    const failure = validateCommit(commit({ signatureState: 'UNSIGNED', signatureValid: false }), accepted);

    expect(failure?.reasons[0]).toContain('UNSIGNED');
  });

  it('reports author and signature problems together', () => {
    const failure = validateCommit(commit({ authorIds: [99999], signatureValid: false }), accepted);

    expect(failure?.reasons).toHaveLength(2);
  });
});

describe('verifyCommits', () => {
  it('verifies a pull request whose commits all pass', () => {
    const result = verifyCommits([commit({ oid: 'a' }), commit({ oid: 'b', authorIds: [67890] })], ACCEPTED);

    expect(result).toEqual({ failures: [], invalidCommits: [], verified: true });
  });

  it('collects every invalid commit, in order', () => {
    const commits = [
      commit({ oid: 'good' }),
      commit({ authorIds: [99999], oid: 'bad-author' }),
      commit({ oid: 'bad-signature', signatureValid: false }),
    ];

    const result = verifyCommits(commits, ACCEPTED);

    expect(result.verified).toBe(false);
    expect(result.invalidCommits).toEqual(['bad-author', 'bad-signature']);
    expect(result.failures).toHaveLength(2);
  });

  it('never verifies an empty commit list', () => {
    expect(verifyCommits([], ACCEPTED)).toEqual({ failures: [], invalidCommits: [], verified: false });
  });

  it('never verifies anything when no author is accepted', () => {
    expect(verifyCommits([commit()], []).verified).toBe(false);
  });
});
