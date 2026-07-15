import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';

import { buildPathspecs } from './pathspec.js';

/** Literal path tokens: no glob metacharacters, not magic, and never the whole-tree pattern `.`. */
const literalTokens = fc
  .array(fc.stringMatching(/^[a-zA-Z0-9_.\-/]+$/), { minLength: 1 })
  .filter((tokens) => tokens.join(' ') !== '.');

describe('buildPathspecs properties', () => {
  it.prop([fc.string()])('never emits an empty pathspec, and only filters when it has some', (pattern) => {
    const { specs, useFilter } = buildPathspecs(pattern);

    expect(specs.every((spec) => spec !== '')).toBe(true);
    expect(useFilter).toBe(specs.length > 0);
  });

  it.prop([literalTokens])('keeps every literal (wildcard-free, non-magic) token verbatim', (tokens) => {
    const { specs } = buildPathspecs(tokens.join(' '));

    expect(specs).toEqual(tokens);
  });

  it.prop([fc.stringMatching(/^[a-zA-Z0-9_.\-/]+$/)])('makes a wildcard token a :(glob) pathspec', (token) => {
    const withGlob = `${token}*`;

    expect(buildPathspecs(withGlob).specs).toEqual([`:(glob)${withGlob}`]);
  });
});
