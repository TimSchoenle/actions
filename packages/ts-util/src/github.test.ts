import { describe, expect, it } from 'vitest';

import { toSafeId } from './github.js';

describe('toSafeId', () => {
  it('passes a number id through', () => {
    expect(toSafeId(123_456_789)).toBe(123_456_789);
  });

  it('narrows a bigint id within the safe range', () => {
    expect(toSafeId(987_654_321n)).toBe(987_654_321);
    expect(toSafeId(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses a bigint id that would lose precision', () => {
    expect(() => toSafeId(BigInt(Number.MAX_SAFE_INTEGER) + 2n)).toThrow(RangeError);
  });

  it('refuses a number that is not a safe integer', () => {
    expect(() => toSafeId(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => toSafeId(1.5)).toThrow(RangeError);
  });
});
