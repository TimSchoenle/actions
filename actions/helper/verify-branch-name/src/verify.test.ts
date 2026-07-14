import { describe, expect, it } from 'vitest';

import { compileBranchPattern, matchesBranchPattern, verifyBranch } from './verify.js';

import type { BranchVerificationRequest } from './verify.js';

const baseRequest: BranchVerificationRequest = {
  baseRepoFullName: 'owner/repo',
  branchPattern: '^feature/.*',
  headRef: 'feature/test',
  headRepoFullName: 'owner/repo',
  rejectForks: true,
};

const request = (overrides: Partial<BranchVerificationRequest> = {}): BranchVerificationRequest => ({
  ...baseRequest,
  ...overrides,
});

describe('compileBranchPattern', () => {
  it('compiles a valid pattern', () => {
    const regex = compileBranchPattern('^feature/.*');

    expect(regex.test('feature/x')).toBe(true);
    expect(regex.test('bugfix/x')).toBe(false);
    expect(regex.flags).toBe('');
  });

  it('throws a descriptive error for an invalid pattern', () => {
    expect(() => compileBranchPattern('^feature/(')).toThrow(/Invalid branch pattern '\^feature\/\('/);
  });
});

describe('matchesBranchPattern', () => {
  it('matches unanchored, like bash [[ =~ ]]', () => {
    expect(matchesBranchPattern('feature', 'my-feature-branch')).toBe(true);
    expect(matchesBranchPattern('^feature', 'my-feature-branch')).toBe(false);
  });

  it('is case sensitive', () => {
    expect(matchesBranchPattern('^feature/.*', 'feature/x')).toBe(true);
    expect(matchesBranchPattern('^feature/.*', 'Feature/x')).toBe(false);
  });

  it('supports escaped separators and character classes', () => {
    expect(matchesBranchPattern('^feature\\/.*', 'feature/x')).toBe(true);
    expect(matchesBranchPattern('^v[0-9]+\\.[0-9]+\\.[0-9]+$', 'v1.2.3')).toBe(true);
    expect(matchesBranchPattern('^v[0-9]+\\.[0-9]+\\.[0-9]+$', 'v1.2')).toBe(false);
  });

  it('supports POSIX character classes carried over from the bash implementation', () => {
    expect(matchesBranchPattern('^release/[[:digit:]]+$', 'release/42')).toBe(true);
    expect(matchesBranchPattern('^release/[[:digit:]]+$', 'release/x')).toBe(false);
  });

  it('aborts a catastrophically backtracking pattern instead of hanging', () => {
    const evil = '^(a+)+$';
    const payload = `${'a'.repeat(40)}!`;

    expect(() => matchesBranchPattern(evil, payload, 100)).toThrow(/could not be evaluated .* within 100ms/);
  });

  it('rejects an invalid pattern', () => {
    expect(() => matchesBranchPattern('(', 'anything')).toThrow(/Invalid branch pattern/);
  });
});

describe('verifyBranch', () => {
  it('verifies a matching branch from the same repository', () => {
    expect(verifyBranch(request())).toEqual({
      branchPatternVerified: true,
      forkVerified: true,
      isFork: false,
      verified: true,
    });
  });

  it('reports a branch pattern mismatch without failing the fork check', () => {
    expect(verifyBranch(request({ headRef: 'bugfix/test' }))).toEqual({
      branchPatternVerified: false,
      forkVerified: true,
      isFork: false,
      verified: false,
    });
  });

  it('rejects a fork when reject_forks is true', () => {
    expect(verifyBranch(request({ headRepoFullName: 'forker/repo' }))).toEqual({
      branchPatternVerified: true,
      forkVerified: false,
      isFork: true,
      verified: false,
    });
  });

  it('accepts a fork when reject_forks is false', () => {
    expect(verifyBranch(request({ headRepoFullName: 'forker/repo', rejectForks: false }))).toEqual({
      branchPatternVerified: true,
      forkVerified: true,
      isFork: true,
      verified: true,
    });
  });

  it('treats repository names case sensitively, like the GitHub payload', () => {
    expect(verifyBranch(request({ headRepoFullName: 'Owner/Repo' })).isFork).toBe(true);
  });

  it('auto-passes the pattern check when no pattern is configured', () => {
    const result = verifyBranch(request({ branchPattern: '', headRef: 'anything' }));

    expect(result.branchPatternVerified).toBe(true);
    expect(result.verified).toBe(true);
  });

  it('does not require a head ref when no pattern is configured', () => {
    expect(verifyBranch(request({ branchPattern: '', headRef: '' })).verified).toBe(true);
  });

  it('fails both checks independently', () => {
    expect(verifyBranch(request({ headRef: 'bugfix/x', headRepoFullName: 'forker/repo' }))).toEqual({
      branchPatternVerified: false,
      forkVerified: false,
      isFork: true,
      verified: false,
    });
  });

  it('throws when a pattern is configured but the head ref is missing', () => {
    expect(() => verifyBranch(request({ headRef: '' }))).toThrow(/Branch name \(head_ref\) not provided/);
  });

  it.each([
    ['head', { headRepoFullName: '' }],
    ['base', { baseRepoFullName: '' }],
  ])('throws when the %s repository name is missing', (_name, overrides) => {
    expect(() => verifyBranch(request(overrides))).toThrow(/Repository names not provided/);
  });
});
