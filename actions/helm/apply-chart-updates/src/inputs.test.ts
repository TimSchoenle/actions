import { describe, expect, it } from 'vitest';

import {
  assertMatches,
  assertValidKey,
  compilePattern,
  InvalidInputError,
  mergeVariables,
  parseImages,
  parsePositiveInteger,
  parseVariables,
} from './inputs.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;

describe('parseImages', () => {
  it('preserves the caller order so the pull request lists images as written', () => {
    const entries = parseImages(
      JSON.stringify({
        'services.render.image.tag': { tag: 'v2.1.0', digest: DIGEST },
        'services.api.image.tag': { tag: 'v1.0.0', digest: DIGEST },
        'bootstrap.image.tag': { tag: 'v1.0.0', digest: DIGEST },
      }),
    );

    expect(entries.map((entry) => entry.key)).toEqual([
      'services.render.image.tag',
      'services.api.image.tag',
      'bootstrap.image.tag',
    ]);
  });

  // The whole point of the per-entry bag: services that release independently carry their own tag.
  it('keeps each entry variables separate', () => {
    const entries = parseImages(
      JSON.stringify({
        'services.api.image.tag': { tag: 'v1.0.0' },
        'services.worker.image.tag': { tag: 'v0.9.4' },
      }),
    );

    expect(entries[0].variables.get('tag')).toBe('v1.0.0');
    expect(entries[1].variables.get('tag')).toBe('v0.9.4');
  });

  it.each([
    ['not JSON at all', '{'],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['a JSON string', '"images"'],
    ['an empty object', '{}'],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseImages(raw)).toThrow(InvalidInputError);
  });

  it('rejects an entry whose value is not an object of variables', () => {
    expect(() => parseImages('{"image.tag": "v1.0.0"}')).toThrow(/must be a JSON object of variables/);
  });

  it('rejects more entries than the cap', () => {
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`a${index}.image.tag`, { tag: 'v1' }]));

    expect(() => parseImages(JSON.stringify(many))).toThrow(/the limit is 100/);
  });

  // A bag is a Map precisely so a prototype name cannot be smuggled in as data.
  it('rejects a prototype-reaching variable name', () => {
    expect(() => parseImages('{"image.tag": {"__proto__": "x"}}')).toThrow(/invalid variable name/);
  });

  it.each([
    ['a newline', 'v1.0.0\nrm -rf /'],
    ['a backtick', 'v1.0.0`whoami`'],
    ['a pipe', 'v1.0.0|cat'],
    ['a quote', 'v1.0.0"'],
    ['a brace', 'v1.0.0${x}'],
  ])('rejects a variable value containing %s', (_label, value) => {
    expect(() => parseImages(JSON.stringify({ 'image.tag': { tag: value } }))).toThrow(/disallowed value/);
  });

  it('rejects a non-string variable value', () => {
    expect(() => parseImages('{"image.tag": {"tag": 3}}')).toThrow(/must be a string/);
  });
});

describe('assertValidKey', () => {
  it.each(['image.tag', 'services.api.image.tag', 'a.0.b', 'a-b_c.tag'])('accepts %s', (key) => {
    expect(() => assertValidKey(key)).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['an empty segment', 'a..b'],
    ['a leading dot', '.a'],
    ['a slash', 'a/b'],
    ['a traversal', '../values'],
    ['a space', 'a b'],
  ])('rejects %s', (_label, key) => {
    expect(() => assertValidKey(key)).toThrow(InvalidInputError);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the prototype segment %s', (segment) => {
    expect(() => assertValidKey(`a.${segment}.tag`)).toThrow(/prototype chain/);
  });

  it('rejects a path deeper than the limit', () => {
    expect(() => assertValidKey('a.b.c.d.e.f.g.h.i.j.k')).toThrow(/levels deep/);
  });
});

describe('parseVariables', () => {
  it('defaults to an empty bag, since most charts share nothing', () => {
    expect(parseVariables('{}').size).toBe(0);
  });

  it('rejects a non-object', () => {
    expect(() => parseVariables('[]')).toThrow(InvalidInputError);
  });
});

describe('mergeVariables', () => {
  it('lets an entry override a shared default', () => {
    const merged = mergeVariables(new Map([['tag', 'v1.0.0']]), new Map([['tag', 'v0.9.4']]));

    expect(merged.get('tag')).toBe('v0.9.4');
  });

  it('does not mutate either input', () => {
    const shared = new Map([['tag', 'v1.0.0']]);
    mergeVariables(shared, new Map([['digest', DIGEST]]));

    expect([...shared.keys()]).toEqual(['tag']);
  });
});

describe('compilePattern', () => {
  it('compiles a valid pattern', () => {
    expect(compilePattern('^a$', 'key-pattern').test('a')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['invalid', '('],
    ['over-long', 'a'.repeat(513)],
  ])('rejects a %s pattern', (_label, raw) => {
    expect(() => compilePattern(raw, 'key-pattern')).toThrow(InvalidInputError);
  });
});

describe('assertMatches', () => {
  it('names both the subject and the pattern when it does not match', () => {
    expect(() => assertMatches(/^v\d/, 'latest', 'rendered value')).toThrow(/rendered value 'latest' does not match/);
  });
});

describe('parsePositiveInteger', () => {
  it('falls back when the input is blank', () => {
    expect(parsePositiveInteger('  ', 'changelog-max-bytes', 42)).toBe(42);
  });

  it.each(['0', '-1', '1.5', 'abc'])('rejects %s', (raw) => {
    expect(() => parsePositiveInteger(raw, 'changelog-max-bytes', 42)).toThrow(InvalidInputError);
  });
});
