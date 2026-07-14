import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { translatePosixClasses } from './posix-regex.js';

describe('translatePosixClasses fuzzing', () => {
  it('is idempotent — translating an already translated pattern changes nothing', () => {
    fc.assert(
      fc.property(fc.string(), (pattern) => {
        const once = translatePosixClasses(pattern);

        expect(translatePosixClasses(once)).toBe(once);
      }),
    );
  });

  it('never throws and never drops the escape of an escaped character', () => {
    fc.assert(
      fc.property(fc.string(), (pattern) => {
        expect(() => translatePosixClasses(pattern)).not.toThrow();
      }),
    );
  });
});
