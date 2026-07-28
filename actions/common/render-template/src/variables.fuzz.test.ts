import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { UnsafeVariableKeyError, VariablesParseError } from './errors.js';
import { parseVariables } from './variables.js';

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

const safeKey = fc.string({ minLength: 1, maxLength: 12 }).filter((key) => !FORBIDDEN_KEYS.includes(key));

/**
 * Any value the `variables` input can carry, with no key that the parser is required to reject.
 *
 * `-0` is normalized away because JSON cannot represent it: `JSON.stringify(-0)` is `"0"`, so a
 * round-trip property built on it would fail for a reason that has nothing to do with this code.
 */
const jsonValue = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }).map((value) => (Object.is(value, -0) ? 0 : value)),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(safeKey, tie('value'), { maxKeys: 4 }),
  ),
})).value;

const safeVariables = fc.dictionary(safeKey, jsonValue, { maxKeys: 6 });

/** Inserts a forbidden key at an arbitrary point inside an otherwise safe document. */
const pollutedVariables = fc
  .tuple(safeVariables, fc.constantFrom(...FORBIDDEN_KEYS), fc.boolean())
  .map(([base, key, nested]) => (nested ? { ...base, wrapper: { list: [{ [key]: 'x' }] } } : { ...base, [key]: 'x' }));

describe('parseVariables fuzzing', () => {
  it('round-trips any JSON document the input can express', () => {
    fc.assert(
      fc.property(safeVariables, (variables) => {
        expect(parseVariables(JSON.stringify(variables))).toEqual(variables);
      }),
    );
  });

  // An each over an object renders in key order, so the order the caller wrote has to survive the
  // rebuild the sanitizer performs.
  it('preserves top-level key order', () => {
    fc.assert(
      fc.property(safeVariables, (variables) => {
        expect(Object.keys(parseVariables(JSON.stringify(variables)))).toEqual(Object.keys(variables));
      }),
    );
  });

  it('rejects a forbidden key wherever it appears', () => {
    fc.assert(
      fc.property(pollutedVariables, (variables) => {
        expect(() => parseVariables(JSON.stringify(variables))).toThrow(UnsafeVariableKeyError);
      }),
    );
  });

  it('never pollutes Object.prototype', () => {
    fc.assert(
      fc.property(pollutedVariables, (variables) => {
        try {
          parseVariables(JSON.stringify(variables));
        } catch {
          // The rejection is asserted above; what matters here is the global state afterwards.
        }

        expect(Object.keys({})).toEqual([]);
        expect(({} as Record<string, unknown>).x).toBeUndefined();
      }),
    );
  });

  // The action turns a thrown message into a failed step, so an input that escapes as a raw
  // TypeError or RangeError would reach a workflow log as noise instead of as a diagnosis.
  it('fails only in its declared ways, for any input at all', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        try {
          parseVariables(raw);
        } catch (error) {
          expect(error).toSatisfy(
            (thrown: unknown) => thrown instanceof VariablesParseError || thrown instanceof UnsafeVariableKeyError,
          );
        }
      }),
    );
  });

  it('always returns an object, never an array or a primitive', () => {
    fc.assert(
      fc.property(safeVariables, (variables) => {
        const parsed = parseVariables(JSON.stringify(variables));

        expect(typeof parsed).toBe('object');
        expect(Array.isArray(parsed)).toBe(false);
      }),
    );
  });
});
