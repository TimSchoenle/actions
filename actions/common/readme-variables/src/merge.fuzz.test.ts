import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { UnsafeKeyError } from './errors.js';
import { deepMerge, parseExtra } from './merge.js';

import type { PayloadMap } from './merge.js';

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

const safeKey = fc.string({ minLength: 1, maxLength: 12 }).filter((key) => !FORBIDDEN_KEYS.includes(key));

/**
 * Any value `extra` can carry, with no key the parser is required to reject.
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

const safeDocument = fc.dictionary(safeKey, jsonValue, { maxKeys: 6 });

/** Inserts a forbidden key at an arbitrary point inside an otherwise safe document. */
const pollutedDocument = fc
  .tuple(safeDocument, fc.constantFrom(...FORBIDDEN_KEYS), fc.boolean())
  .map(([base, key, nested]) => (nested ? { ...base, wrapper: { list: [{ [key]: 'x' }] } } : { ...base, [key]: 'x' }));

describe('parseExtra fuzzing', () => {
  it('round-trips any JSON document the input can express', () => {
    fc.assert(
      fc.property(safeDocument, (document) => {
        expect(parseExtra(JSON.stringify(document))).toEqual(document);
      }),
    );
  });

  it('rejects a forbidden key wherever it appears', () => {
    fc.assert(
      fc.property(pollutedDocument, (document) => {
        expect(() => parseExtra(JSON.stringify(document))).toThrow(UnsafeKeyError);
      }),
    );
  });

  it('never returns a value that reaches Object.prototype', () => {
    fc.assert(
      fc.property(safeDocument, (document) => {
        const parsed = parseExtra(JSON.stringify(document));

        expect(Object.hasOwn(parsed, '__proto__')).toBe(false);
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
      }),
    );
  });
});

describe('deepMerge fuzzing', () => {
  it('is idempotent: merging an overlay twice equals merging it once', () => {
    fc.assert(
      fc.property(safeDocument, safeDocument, (base, overlay) => {
        const once = deepMerge(base as PayloadMap, overlay as PayloadMap);

        expect(deepMerge(once, overlay as PayloadMap)).toEqual(once);
      }),
    );
  });

  it('leaves an empty overlay as the identity', () => {
    fc.assert(
      fc.property(safeDocument, (base) => {
        expect(deepMerge(base as PayloadMap, {})).toEqual(base);
      }),
    );
  });

  it('keeps every key of both sides', () => {
    fc.assert(
      fc.property(safeDocument, safeDocument, (base, overlay) => {
        const merged = deepMerge(base as PayloadMap, overlay as PayloadMap);
        const expected = new Set([...Object.keys(base), ...Object.keys(overlay)]);

        expect(new Set(Object.keys(merged))).toEqual(expected);
      }),
    );
  });

  it('never mutates its arguments', () => {
    fc.assert(
      fc.property(safeDocument, safeDocument, (base, overlay) => {
        const baseCopy = structuredClone(base);
        const overlayCopy = structuredClone(overlay);

        deepMerge(base as PayloadMap, overlay as PayloadMap);

        expect(base).toEqual(baseCopy);
        expect(overlay).toEqual(overlayCopy);
      }),
    );
  });
});
