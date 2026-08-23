import { describe, expect, it } from 'vitest';

import { ExtraParseError, UnsafeKeyError } from './errors.js';
import { deepMerge, parseExtra } from './merge.js';

describe('parseExtra', () => {
  it.each([
    ['an empty input', ''],
    ['a whitespace-only input', '   \n '],
  ])('reads %s as an empty map, so a caller with nothing to add needs no with: entry', (_label, raw) => {
    expect(parseExtra(raw)).toEqual({});
  });

  it('parses a nested document', () => {
    expect(parseExtra('{"publish":{"image":"timschoenle/portfolio","platforms":["amd64","arm64"]}}')).toEqual({
      publish: { image: 'timschoenle/portfolio', platforms: ['amd64', 'arm64'] },
    });
  });

  it('refuses input that is not JSON', () => {
    expect(() => parseExtra('{not json}')).toThrow(ExtraParseError);
  });

  it.each([
    ['an array', '[]'],
    ['a bare number', '42'],
    ['null', 'null'],
  ])('refuses %s at the top level', (_label, raw) => {
    expect(() => parseExtra(raw)).toThrow(/the top level is not a JSON object/);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('refuses the key %s at the top level', (key) => {
    expect(() => parseExtra(JSON.stringify({ [key]: 'x' }))).toThrow(UnsafeKeyError);
  });

  it('refuses a forbidden key nested inside an array', () => {
    const raw = JSON.stringify({ docs: [{ constructor: 'x' }] });

    expect(() => parseExtra(raw)).toThrow(/\$\.docs\[0\]/);
  });

  it('refuses a document nested past the depth limit', () => {
    let document = '1';

    for (let depth = 0; depth < 70; depth++) {
      document = `{"a":${document}}`;
    }

    expect(() => parseExtra(document)).toThrow(/exceeds the maximum depth/);
  });
});

describe('deepMerge', () => {
  it('recurses into objects rather than replacing them wholesale', () => {
    expect(deepMerge({ repo: { name: 'Portfolio', branch: 'main' } }, { repo: { branch: 'develop' } })).toEqual({
      repo: { name: 'Portfolio', branch: 'develop' },
    });
  });

  it('adds keys the base does not carry', () => {
    expect(deepMerge({ repo: {} }, { publish: { image: 'x' } })).toEqual({ repo: {}, publish: { image: 'x' } });
  });

  // Appending would make the result depend on what the reader happened to find.
  it('replaces an array rather than concatenating it', () => {
    expect(deepMerge({ docs: [{ path: 'a' }, { path: 'b' }] }, { docs: [{ path: 'c' }] })).toEqual({
      docs: [{ path: 'c' }],
    });
  });

  it('lets a scalar in the overlay replace an object in the base', () => {
    expect(deepMerge({ release: { version: '1' } }, { release: 'unreleased' })).toEqual({ release: 'unreleased' });
  });

  it('lets null replace a derived field, which is how a caller deletes one', () => {
    expect(deepMerge({ repo: { homepage: 'https://example.test' } }, { repo: { homepage: null } })).toEqual({
      repo: { homepage: null },
    });
  });

  it('does not mutate either argument', () => {
    const base = { repo: { name: 'a' } };
    const overlay = { repo: { name: 'b' } };

    deepMerge(base, overlay);

    expect(base).toEqual({ repo: { name: 'a' } });
    expect(overlay).toEqual({ repo: { name: 'b' } });
  });
});
