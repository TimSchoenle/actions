import { describe, expect, it } from 'vitest';

import { compilePosixRegex, PATTERN_MATCH_TIMEOUT_MS, testPattern, translatePosixClasses } from './posix-regex.js';

describe('translatePosixClasses', () => {
  it('translates a class inside a bracket expression', () => {
    expect(translatePosixClasses('^[[:digit:]]+$')).toBe('^[0-9]+$');
    expect(translatePosixClasses('^build-[[:digit:]]+$')).toBe('^build-[0-9]+$');
  });

  it('translates several classes in one bracket expression', () => {
    expect(translatePosixClasses('^[[:alpha:][:digit:]_-]+$')).toBe('^[A-Za-z0-9_-]+$');
    expect(translatePosixClasses('release/[[:alnum:].]+')).toBe('release/[A-Za-z0-9.]+');
  });

  it('translates a class in a negated bracket expression', () => {
    expect(translatePosixClasses('[^[:space:]]')).toBe('[^\\s]');
  });

  it('leaves a class outside a bracket expression untouched', () => {
    expect(translatePosixClasses('[:digit:]')).toBe('[:digit:]');
    expect(translatePosixClasses('x[:digit:]')).toBe('x[:digit:]');
  });

  it('leaves an unknown class untouched', () => {
    expect(translatePosixClasses('[[:unknown:]]')).toBe('[[:unknown:]]');
  });

  it('leaves an unterminated class untouched', () => {
    expect(translatePosixClasses('[[:digit]')).toBe('[[:digit]');
  });

  it('does not treat an escaped bracket as opening a bracket expression', () => {
    expect(translatePosixClasses('\\[[:digit:]\\]')).toBe('\\[[:digit:]\\]');
    expect(translatePosixClasses('\\[x\\]')).toBe('\\[x\\]');
  });

  it.each(['^feature/.*$', 'v[0-9]+', 'plain', ''])(
    'leaves the pattern without POSIX classes untouched: %s',
    (pattern) => {
      expect(translatePosixClasses(pattern)).toBe(pattern);
    },
  );
});

describe('compilePosixRegex', () => {
  it('compiles an unanchored, case-sensitive pattern', () => {
    const regex = compilePosixRegex('^feature/.*');

    expect(regex.test('feature/x')).toBe(true);
    expect(regex.test('Feature/x')).toBe(false);
  });

  it('compiles a POSIX bracket class', () => {
    expect(compilePosixRegex('^release/[[:digit:]]+$').test('release/42')).toBe(true);
    expect(compilePosixRegex('^release/[[:digit:]]+$').test('release/x')).toBe(false);
  });

  it('throws on a pattern that is not a valid RegExp', () => {
    expect(() => compilePosixRegex('^feature/(')).toThrow(SyntaxError);
  });
});

describe('testPattern', () => {
  it('matches unanchored, like bash', () => {
    expect(testPattern(compilePosixRegex('feature'), 'my-feature-branch')).toBe(true);
    expect(testPattern(compilePosixRegex('^feature'), 'my-feature-branch')).toBe(false);
  });

  it('defaults to the shared evaluation budget', () => {
    expect(PATTERN_MATCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(testPattern(compilePosixRegex('^v[0-9]+\\.[0-9]+$'), 'v1.2')).toBe(true);
  });

  it('throws instead of hanging on catastrophic backtracking', () => {
    const evil = '^(a+)+$';
    const payload = `${'a'.repeat(40)}!`;

    expect(() => testPattern(compilePosixRegex(evil), payload, 100)).toThrow();
  });
});
