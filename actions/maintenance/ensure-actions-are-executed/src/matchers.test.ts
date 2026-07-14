import { describe, expect, it } from 'vitest';

import {
  InvalidMatcherError,
  MatcherEvaluationError,
  matchesCheckName,
  NoMatchersError,
  normalizeMatchers,
  parseMatchMode,
  resolveMatcher,
  selectChecks,
} from './matchers.js';

import type { CheckRun } from './checks.js';
import type { MatchMode } from './matchers.js';

function checkRun(name: string, id = 1): CheckRun {
  return { conclusion: 'success', detailsUrl: null, id, name, status: 'completed' };
}

function matchers(raws: string[], mode: MatchMode = 'auto') {
  return raws.map((raw) => resolveMatcher(raw, mode));
}

describe('parseMatchMode', () => {
  it.each([
    ['auto', 'auto'],
    ['EXACT', 'exact'],
    ['  Regex  ', 'regex'],
  ])('normalizes %o to %o', (value, expected) => {
    expect(parseMatchMode(value)).toBe(expected);
  });

  it.each(['', 'glob', 'exactly'])('rejects the unsupported mode %o', (value) => {
    expect(() => parseMatchMode(value)).toThrow(`Invalid match_mode '${value}'. Allowed values: auto, exact, regex.`);
  });
});

describe('normalizeMatchers', () => {
  it('splits on newlines and commas, trimming and dropping empties', () => {
    expect(normalizeMatchers('  build \n\n test,lint ,,\n  ')).toEqual(['build', 'test', 'lint']);
  });

  it('keeps duplicates, so every configured matcher is reported', () => {
    expect(normalizeMatchers('build\nbuild')).toEqual(['build', 'build']);
  });

  it.each(['', '   ', '\n', ',,\n ,'])('rejects the empty configuration %o', (checks) => {
    expect(() => normalizeMatchers(checks)).toThrow(NoMatchersError);
  });
});

describe('resolveMatcher', () => {
  it('reads a slash-wrapped matcher as a regex in auto mode and strips the slashes', () => {
    const matcher = resolveMatcher('/^build \\(\\d+\\)$/', 'auto');

    expect(matcher.mode).toBe('regex');
    expect(matcher.regex?.source).toBe('^build \\(\\d+\\)$');
    expect(matcher.raw).toBe('/^build \\(\\d+\\)$/');
  });

  it.each(['build', 'build (18.x)', '/', '//', 'a/b/c'])('reads %o as an exact matcher in auto mode', (raw) => {
    const matcher = resolveMatcher(raw, 'auto');

    expect(matcher.mode).toBe('exact');
    expect(matcher.regex).toBeUndefined();
  });

  it('forces a regex in regex mode, without stripping slashes', () => {
    const matcher = resolveMatcher('^lint', 'regex');

    expect(matcher.mode).toBe('regex');
    expect(matcher.regex?.source).toBe('^lint');
  });

  it('forces an exact match in exact mode, even for a slash-wrapped matcher', () => {
    const matcher = resolveMatcher('/^lint$/', 'exact');

    expect(matcher.mode).toBe('exact');
    expect(matchesCheckName(matcher, 'lint')).toBe(false);
    expect(matchesCheckName(matcher, '/^lint$/')).toBe(true);
  });

  it.each([
    ['/[unterminated/', 'auto'],
    ['(', 'regex'],
    ['a{2,1}', 'regex'],
  ] as const)('rejects the uncompilable matcher %o in %s mode', (raw, mode) => {
    expect(() => resolveMatcher(raw, mode)).toThrow(InvalidMatcherError);
    expect(() => resolveMatcher(raw, mode)).toThrow(`Invalid regex matcher '${raw}'`);
  });

  it('never rejects an uncompilable pattern that is used as an exact matcher', () => {
    expect(resolveMatcher('build (', 'exact').mode).toBe('exact');
    expect(resolveMatcher('build (', 'auto').mode).toBe('exact');
  });
});

describe('matchesCheckName under catastrophic backtracking', () => {
  // Evaluation is time-boxed, so a matcher that cannot finish fails the step. Reporting it as
  // "unmatched" would read as "the check never started", which this action tolerates — turning a
  // hung verification into a silent pass.
  it('fails rather than hanging, and never reports the check as unmatched', () => {
    const matcher = resolveMatcher('/^(a+)+$/', 'auto');
    const checkName = `${'a'.repeat(40)}!`;

    expect(() => matchesCheckName(matcher, checkName)).toThrow(MatcherEvaluationError);
  });
});

describe('POSIX class matchers survive the migration from bash', () => {
  // A matcher written for the shell predecessor must keep selecting the same checks. An untranslated
  // class would compile to a regex matching nothing, which this action reads as "not started" — a
  // silent pass, the one outcome a verification gate must never produce.
  it('selects the checks a bash-era POSIX matcher selected', () => {
    const matcher = resolveMatcher('/^build-[[:digit:]]+$/', 'auto');

    expect(matcher.mode).toBe('regex');
    expect(matchesCheckName(matcher, 'build-18')).toBe(true);
    expect(matchesCheckName(matcher, 'build-x')).toBe(false);
  });

  it('applies the translation in forced regex mode too', () => {
    const matcher = resolveMatcher('^test-[[:alnum:]]+$', 'regex');

    expect(matchesCheckName(matcher, 'test-18x')).toBe(true);
    expect(matchesCheckName(matcher, 'test-!')).toBe(false);
  });
});

describe('matchesCheckName', () => {
  it('compares an exact matcher literally, without regex semantics', () => {
    const matcher = resolveMatcher('build (18.x)', 'exact');

    expect(matchesCheckName(matcher, 'build (18.x)')).toBe(true);
    expect(matchesCheckName(matcher, 'build 18x')).toBe(false);
    expect(matchesCheckName(matcher, 'pre build (18.x)')).toBe(false);
  });

  // Bash's `[[ $name =~ $pattern ]]` is unanchored, and so is RegExp.test — keeping that means
  // existing workflows select the same checks.
  it('matches a regex matcher anywhere in the name', () => {
    const matcher = resolveMatcher('/lint/', 'auto');

    expect(matchesCheckName(matcher, 'lint')).toBe(true);
    expect(matchesCheckName(matcher, 'pre-lint (18.x)')).toBe(true);
    expect(matchesCheckName(matcher, 'build')).toBe(false);
  });

  it('honours anchors in a regex matcher', () => {
    const matcher = resolveMatcher('/^lint$/', 'auto');

    expect(matchesCheckName(matcher, 'lint')).toBe(true);
    expect(matchesCheckName(matcher, 'lint (18.x)')).toBe(false);
  });

  it('is case sensitive', () => {
    expect(matchesCheckName(resolveMatcher('Build', 'exact'), 'build')).toBe(false);
    expect(matchesCheckName(resolveMatcher('/^Build/', 'auto'), 'build')).toBe(false);
  });
});

describe('selectChecks', () => {
  const checkRuns = [checkRun('build (18.x)', 1), checkRun('build (20.x)', 2), checkRun('lint', 3)];

  it('reports what every matcher selected, in configuration order', () => {
    const selection = selectChecks(checkRuns, matchers(['lint', '/^build/']));

    expect(selection.outcomes.map((outcome) => [outcome.matcher.raw, outcome.matchedNames])).toEqual([
      ['lint', ['lint']],
      ['/^build/', ['build (18.x)', 'build (20.x)']],
    ]);
  });

  it('deduplicates checks selected by more than one matcher and orders them by name', () => {
    const selection = selectChecks(checkRuns, matchers(['/build/', '/^build \\(18/', 'lint']));

    expect(selection.selected.map((check) => check.name)).toEqual(['build (18.x)', 'build (20.x)', 'lint']);
  });

  // A check that never started produces no check run. That is exactly the condition this action
  // tolerates, so an empty match is reported, not rejected.
  it('selects nothing for a matcher that matches nothing, without failing', () => {
    const selection = selectChecks(checkRuns, matchers(['deploy']));

    expect(selection.selected).toEqual([]);
    expect(selection.outcomes[0].matchedNames).toEqual([]);
  });

  it('selects nothing when there are no check runs at all', () => {
    const selection = selectChecks([], matchers(['/.*/']));

    expect(selection.selected).toEqual([]);
    expect(selection.outcomes).toHaveLength(1);
  });
});
