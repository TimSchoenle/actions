import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';

import { matchesCheckName, NoMatchersError, normalizeMatchers, resolveMatcher, selectChecks } from './matchers.js';

import type { CheckRun } from './checks.js';

/** Check names as GitHub reports them: word characters plus the punctuation of a matrix job. */
const checkName = fc.stringMatching(/^[\w .()\-/]{1,40}$/);

/** Escapes every character JavaScript's RegExp gives a special meaning, leaving a literal pattern. */
function escapeRegex(value: string): string {
  return value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

function checkRun(name: string, id = 1): CheckRun {
  return { conclusion: 'success', detailsUrl: null, id, name, status: 'completed' };
}

describe('normalizeMatchers fuzzing', () => {
  it.prop([fc.string()])('never yields a blank matcher or one carrying a separator', (checks) => {
    let matchers: string[];

    try {
      matchers = normalizeMatchers(checks);
    } catch {
      // Rejecting a configuration that holds nothing but separators and whitespace is the contract,
      // covered by the example-based tests; here only the shape of a successful result matters.
      return;
    }

    expect(matchers.length).toBeGreaterThan(0);
    for (const matcher of matchers) {
      expect(matcher).not.toBe('');
      expect(matcher.trim()).toBe(matcher);
      expect(matcher).not.toContain(',');
      expect(matcher).not.toContain('\n');
    }
  });

  it.prop([fc.string()])('rejects exactly the configurations that hold no matcher', (checks) => {
    const holdsMatcher = checks.split(/[\n,]/).some((entry) => entry.trim() !== '');

    if (holdsMatcher) {
      expect(() => normalizeMatchers(checks)).not.toThrow();
    } else {
      expect(() => normalizeMatchers(checks)).toThrow(NoMatchersError);
    }
  });
});

describe('resolveMatcher fuzzing', () => {
  it.prop([fc.string()])('never rejects a matcher that is compared literally', (raw) => {
    expect(resolveMatcher(raw, 'exact').mode).toBe('exact');
  });

  it.prop([checkName])('matches a check name against itself as an exact matcher', (name) => {
    expect(matchesCheckName(resolveMatcher(name, 'exact'), name)).toBe(true);
  });

  it.prop([checkName, checkName])('accepts an exact matcher only for an identical name', (matcher, name) => {
    expect(matchesCheckName(resolveMatcher(matcher, 'exact'), name)).toBe(matcher === name);
  });

  it.prop([checkName])('reads a slash-wrapped literal as a regex in auto mode', (name) => {
    const matcher = resolveMatcher(`/${escapeRegex(name)}/`, 'auto');

    expect(matcher.mode).toBe('regex');
    expect(matchesCheckName(matcher, name)).toBe(true);
  });
});

describe('matchesCheckName fuzzing', () => {
  // Bash's `[[ $name =~ $pattern ]]` is unanchored and so is RegExp.test: any substring of a check
  // name, used as a literal pattern, selects that check.
  it.prop([checkName, fc.nat(), fc.nat()])('matches any substring of the check name', (name, start, length) => {
    const from = start % name.length;
    const substring = name.slice(from, from + (length % name.length) + 1);

    expect(matchesCheckName(resolveMatcher(escapeRegex(substring), 'regex'), name)).toBe(true);
  });
});

describe('selectChecks fuzzing', () => {
  it.prop([fc.uniqueArray(checkName, { maxLength: 8 }), fc.uniqueArray(checkName, { maxLength: 4 })])(
    'selects exactly the union of the matcher outcomes, deduplicated and ordered by name',
    (names, rawMatchers) => {
      const checkRuns = names.map((name, index) => checkRun(name, index + 1));
      const selection = selectChecks(
        checkRuns,
        rawMatchers.map((raw) => resolveMatcher(raw, 'exact')),
      );

      const selectedNames = selection.selected.map((check) => check.name);
      const union = [...new Set(selection.outcomes.flatMap((outcome) => outcome.matchedNames))];

      expect(selection.outcomes).toHaveLength(rawMatchers.length);
      expect([...selectedNames].sort((left, right) => left.localeCompare(right))).toEqual(selectedNames);
      expect(new Set(selectedNames)).toEqual(new Set(union));
      expect(selectedNames.every((name) => names.includes(name))).toBe(true);
    },
  );
});
