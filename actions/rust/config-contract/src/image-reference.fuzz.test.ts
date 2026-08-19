import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import { parseImageReference } from './image-reference.js';

/**
 * Properties of the one input that becomes an argument to `docker`.
 *
 * The interesting half is not "which references are accepted" — the example-based cases cover that —
 * but that no string at all gets a third outcome. A reference either parses into parts that
 * reassemble into itself, or is refused with an error naming the input. Anything else is either a
 * crash inside a step that should have reported a verdict, or a value passed on to `docker` that
 * this action never actually read.
 */

const component = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,10}$/);
const tag = fc.stringMatching(/^\w[\w.-]{0,10}$/);
const digest = fc.stringMatching(/^[0-9a-f]{64}$/).map((hex) => `sha256:${hex}`);

const wellFormed = fc
  .tuple(
    fc.array(component, { minLength: 1, maxLength: 3 }),
    fc.option(tag, { nil: undefined }),
    fc.option(digest, { nil: undefined }),
  )
  .map(([components, withTag, withDigest]) => {
    const name = components.join('/');

    return `${name}${withTag === undefined ? '' : `:${withTag}`}${withDigest === undefined ? '' : `@${withDigest}`}`;
  });

describe('parseImageReference fuzzing', () => {
  it('either parses a reference or refuses it, never anything else', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (value) => {
        try {
          const parsed = parseImageReference(value);

          expect(parsed.reference).toBe(value.trim());
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidInputError);
        }
      }),
      { numRuns: 2000 },
    );
  });

  // An accepted reference is passed to `docker` as a bare argument. Anything docker would read as a
  // flag has to be refused, and there is no second line of defence behind this one.
  it('never accepts a reference docker would read as a flag', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (value) => {
        try {
          expect(parseImageReference(value).reference.startsWith('-')).toBe(false);
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidInputError);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('accepts every well-formed reference', () => {
    fc.assert(
      fc.property(wellFormed, (value) => {
        expect(parseImageReference(value).reference).toBe(value);
      }),
    );
  });

  // The parts are what tells a port from a tag, and a wrong split is a reference that passes here
  // and fails against a registry. Reassembly is the cheapest statement that the split was faithful.
  it('splits a well-formed reference into parts that reassemble into it', () => {
    fc.assert(
      fc.property(wellFormed, (value) => {
        const { name, tag: parsedTag, digest: parsedDigest } = parseImageReference(value);
        const rebuilt = `${name}${parsedTag === undefined ? '' : `:${parsedTag}`}${parsedDigest === undefined ? '' : `@${parsedDigest}`}`;

        expect(rebuilt).toBe(value);
      }),
    );
  });

  // A workflow input reaching a pattern is a denial-of-service seam on a billed runner: the step
  // does not fail, it simply never ends. Every quantifier here is bounded, and this is what says so.
  it('stays fast against the shapes that make a naive pattern backtrack', () => {
    const started = Date.now();

    for (const value of [
      'a'.repeat(5000),
      `${'a.'.repeat(2000)}!`,
      `${'a/'.repeat(2000)}b`,
      `a:${'v.'.repeat(2000)}`,
    ]) {
      expect(() => parseImageReference(value)).toThrow(InvalidInputError);
    }

    expect(Date.now() - started).toBeLessThan(1000);
  });
});
