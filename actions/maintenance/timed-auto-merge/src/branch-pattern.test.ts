import { describe, expect, it } from 'vitest';

import { createBranchMatcher, parsePatternMode, toBranchRegex } from './branch-pattern.js';

/** The pattern helm-charts selects its chart-update and non-major Renovate branches with. */
const HELM_CHARTS_PATTERN = '(chore/helm/auto-update/|renovate/([^m]|m[^a]|ma[^j]|maj[^o]|majo[^r]))%';

function matches(pattern: string, mode: 'legacy' | 'regex', branches: string[]): boolean[] {
  return createBranchMatcher(pattern, mode).matchAll(branches);
}

describe('parsePatternMode', () => {
  it.each(['legacy', 'regex'])('accepts %s', (mode) => {
    expect(parsePatternMode(mode)).toBe(mode);
  });

  it.each(['', 'Legacy', 'glob', 'regex '])('rejects %j', (mode) => {
    expect(() => parsePatternMode(mode)).toThrow(/Invalid 'pattern_mode'/);
  });
});

describe('toBranchRegex', () => {
  it('translates every % to .* and anchors a group at the start in legacy mode', () => {
    expect(toBranchRegex('release-please--branches--%', 'legacy')).toBe('^(?:release-please--branches--.*)');
    expect(toBranchRegex('a%b%', 'legacy')).toBe('^(?:a.*b.*)');
  });

  it('rejects a legacy pattern that would close the anchoring group early', () => {
    // Wrapped as is, this would become `^(?:x)|(y)`, leaving `y` free to match anywhere.
    expect(() => toBranchRegex('x)|(y', 'legacy')).toThrow(/Invalid 'branch_pattern' "x\)\|\(y"/);
    expect(() => toBranchRegex('x)|(y', 'legacy')).toThrow(/balanced parentheses/);
    expect(() => createBranchMatcher('release/%)|(hotfix/%', 'legacy')).toThrow(/Invalid 'branch_pattern'/);
  });

  it('keeps escaped and bracketed parentheses in a legacy pattern', () => {
    expect(toBranchRegex(String.raw`a\)%`, 'legacy')).toBe(String.raw`^(?:a\).*)`);
    expect(toBranchRegex('a[)]%', 'legacy')).toBe('^(?:a[)].*)');
  });

  it('passes the pattern through unchanged in regex mode', () => {
    expect(toBranchRegex('^release-%$', 'regex')).toBe('^release-%$');
  });
});

describe('createBranchMatcher', () => {
  it('matches the release-please branches the default pattern is for', () => {
    expect(
      matches('release-please--branches--%', 'legacy', [
        'release-please--branches--main',
        'release-please--branches--main--components--x',
        'feature/release-please--branches--main',
        'release-please--branches-main',
      ]),
    ).toEqual([true, true, false, false]);
  });

  it('keeps the helm-charts pattern working, including its renovate major-update exclusion', () => {
    expect(
      matches(HELM_CHARTS_PATTERN, 'legacy', [
        'chore/helm/auto-update/nginx',
        'renovate/minor-deps',
        'renovate/patch-deps',
        'renovate/major-deps',
        'feature/renovate/minor',
        'chore/helm/other',
      ]),
    ).toEqual([true, true, true, false, false, false]);
  });

  it('anchors every alternative in legacy mode, not only the first', () => {
    // `^a|b` would anchor only `a` and let `b` match anywhere in the name.
    expect(matches('release/%|hotfix/%', 'legacy', ['hotfix/1', 'evil/hotfix/1'])).toEqual([true, false]);
  });

  it('anchors both alternatives of a renovate or dependabot pattern', () => {
    expect(
      matches('renovate/%|dependabot/%', 'legacy', [
        'renovate/x',
        'dependabot/npm/x',
        'feature/renovate/x',
        'feature/dependabot/x',
      ]),
    ).toEqual([true, true, false, false]);
  });

  it('matches escaped and bracketed parentheses literally in legacy mode', () => {
    expect(matches(String.raw`fix\(%\)`, 'legacy', ['fix(a)', 'x/fix(a)', 'fixa'])).toEqual([true, false, false]);
    expect(matches('fix[()]%', 'legacy', ['fix(a', 'fix)a', 'x/fix)a'])).toEqual([true, true, false]);
  });

  it('is case-sensitive', () => {
    expect(matches('release-%', 'legacy', ['Release-1'])).toEqual([false]);
  });

  it('translates POSIX bracket classes', () => {
    expect(matches('release/[[:digit:]]+$', 'legacy', ['release/42', 'release/x'])).toEqual([true, false]);
  });

  it('leaves a regex-mode pattern unanchored', () => {
    expect(matches('release', 'regex', ['my-release-branch', 'main'])).toEqual([true, false]);
  });

  it('returns an empty list for no branches', () => {
    expect(matches('%', 'legacy', [])).toEqual([]);
  });

  it('refuses an empty pattern, which would select every open pull request', () => {
    expect(() => createBranchMatcher('', 'legacy')).toThrow(/must not be empty/);
    expect(() => createBranchMatcher('', 'regex')).toThrow(/must not be empty/);
  });

  it('refuses a pattern that does not compile', () => {
    expect(() => createBranchMatcher('release-(%', 'legacy')).toThrow(/Invalid 'branch_pattern'/);
    expect(() => createBranchMatcher('release-(', 'regex')).toThrow(/Invalid branch pattern/);
  });

  it('fails within the time budget on a pattern that backtracks catastrophically', () => {
    const matcher = createBranchMatcher('(a+)+$', 'regex', 100);
    const started = Date.now();

    expect(() => matcher.matchAll(['main', `${'a'.repeat(40)}!`])).toThrow(/within 100ms .*catastrophic backtracking/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('bounds the whole batch, not each branch name', () => {
    // Twenty names that each take a fraction of the budget must not add up to twenty budgets.
    const matcher = createBranchMatcher('(a|a)*$', 'regex', 100);
    const names = Array.from({ length: 20 }, () => `${'a'.repeat(24)}!`);

    expect(() => matcher.matchAll(names)).toThrow(/within 100ms/);
  });
});
