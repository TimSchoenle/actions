import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import { parseDuration, resolveMinimumOpenTime } from './duration.js';

describe('parseDuration', () => {
  it.each([
    ['0s', 0],
    ['45s', 45_000],
    ['30m', 1_800_000],
    ['24h', 86_400_000],
    ['1d', 86_400_000],
    ['7d', 604_800_000],
    ['999999d', 999_999 * 86_400_000],
  ])('reads %s as %d ms', (text, milliseconds) => {
    expect(parseDuration(text, 'time_elapsed')).toEqual({ milliseconds, text });
  });

  it.each([
    ['an empty value', ''],
    ['a bare number', '24'],
    ['a unit alone', 'h'],
    ['a negative number', '-1d'],
    ['a fraction', '1.5h'],
    ['a leading zero', '01h'],
    ['an upper-case unit', '1D'],
    ['a week unit', '1w'],
    ['a compound value', '1d12h'],
    ['surrounding whitespace', ' 1d'],
    ['a trailing newline', '1d\n'],
    ['a word GNU date would accept', 'tomorrow'],
    ['a spelled-out unit', '1 day'],
    ['seven digits', '1000000d'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseDuration(text, 'time_elapsed')).toThrow(/Invalid 'time_elapsed'/);
  });

  test.prop([fc.integer({ max: 999_999, min: 0 }), fc.constantFrom('s', 'm', 'h', 'd')])(
    'round-trips every accepted value to an exact integer',
    (amount, unit) => {
      const { milliseconds } = parseDuration(`${amount}${unit}`, 'x');

      expect(Number.isSafeInteger(milliseconds)).toBe(true);
      expect(milliseconds).toBeGreaterThanOrEqual(amount * 1000);
    },
  );

  test.prop([fc.string()])('either rejects a string or reads it as a non-negative integer', (text) => {
    let parsed: number | undefined;

    try {
      parsed = parseDuration(text, 'x').milliseconds;
    } catch {
      parsed = undefined;
    }

    if (parsed !== undefined) {
      expect(/^(0|[1-9]\d{0,5})[smhd]$/.test(text)).toBe(true);
      expect(Number.isSafeInteger(parsed) && parsed >= 0).toBe(true);
    }
  });
});

describe('resolveMinimumOpenTime', () => {
  it('accepts time_elapsed equal to minimum_age', () => {
    expect(resolveMinimumOpenTime('60m', '1h').milliseconds).toBe(3_600_000);
  });

  it('accepts time_elapsed above minimum_age', () => {
    expect(resolveMinimumOpenTime('1d', '1h')).toEqual({ milliseconds: 86_400_000, text: '1d' });
  });

  it('rejects a dispatch asking for 0s against the default minimum', () => {
    expect(() => resolveMinimumOpenTime('0s', '1h')).toThrow(/'time_elapsed' "0s" is shorter than 'minimum_age' "1h"/);
  });

  it('rejects time_elapsed one second below minimum_age', () => {
    expect(() => resolveMinimumOpenTime('3599s', '1h')).toThrow(/shorter than 'minimum_age'/);
  });

  it('allows 0s only when the workflow lowers minimum_age to 0s', () => {
    expect(resolveMinimumOpenTime('0s', '0s').milliseconds).toBe(0);
  });

  it('names the input a malformed value came from', () => {
    expect(() => resolveMinimumOpenTime('1d', 'soon')).toThrow(/Invalid 'minimum_age' "soon"/);
    expect(() => resolveMinimumOpenTime('soon', '1h')).toThrow(/Invalid 'time_elapsed' "soon"/);
  });
});
