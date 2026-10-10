import { describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import { LANGUAGES, parseBoolean, parseLanguage, parsePattern, parsePatterns, resolveOptions } from './options.js';

import type { RawInputs } from './options.js';

const DEFAULTS: RawInputs = {
  language: 'rust',
  excludeTestPaths: 'true',
  pathsIgnore: '',
  category: '',
  upload: 'true',
};

function resolve(overrides: Partial<RawInputs> = {}) {
  return resolveOptions({ ...DEFAULTS, ...overrides });
}

function failureOf(action: () => unknown): { input: string; message: string } | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return { input: error.input, message: error.message };
    }

    throw error;
  }

  return undefined;
}

describe('parseLanguage', () => {
  it.each(LANGUAGES)('accepts %s', (language) => {
    expect(parseLanguage(` ${language} `)).toBe(language);
  });

  it.each([
    ['javascript', 'javascript-typescript'],
    ['typescript', 'javascript-typescript'],
    ['java', 'java-kotlin'],
    ['kotlin', 'java-kotlin'],
    ['c', 'c-cpp'],
    ['cpp', 'c-cpp'],
  ])('refuses the alias %s and names %s', (alias, canonical) => {
    expect(failureOf(() => parseLanguage(alias))).toMatchObject({
      input: 'language',
      message: expect.stringContaining(`"${canonical}"`),
    });
  });

  it.each(['go', 'swift'])('refuses %s, which needs a build', (language) => {
    expect(failureOf(() => parseLanguage(language))?.message).toContain('has no build-mode none');
  });

  it.each(['', 'Rust', 'cobol', 'rust,actions'])('refuses %j', (value) => {
    expect(failureOf(() => parseLanguage(value))?.message).toContain('is not a CodeQL language');
  });
});

describe('parseBoolean', () => {
  it.each([
    ['true', true],
    ['True', true],
    [' TRUE ', true],
    ['false', false],
    ['FALSE', false],
  ])('reads %j as %s', (value, expected) => {
    expect(parseBoolean('upload', value)).toBe(expected);
  });

  it.each(['', 'yes', '1', 'on'])('refuses %j under the composite input name', (value) => {
    expect(failureOf(() => parseBoolean('exclude-test-paths', value))?.input).toBe('exclude-test-paths');
  });
});

describe('parsePattern', () => {
  it.each(['**/fixtures/**', 'services/api/test-support/**', '**/*.snap', 'docs', '**', 'a/**/b/*.rs'])(
    'accepts %s',
    (pattern) => {
      expect(parsePattern(pattern)).toBe(pattern);
    },
  );

  it.each([
    ['!keep/**', 'matches literally'],
    ['src/?.rs', 'matches literally'],
    ['src/[ab].rs', 'matches literally'],
    ['src/a+b.rs', 'matches literally'],
    ['src\\tests\\**', 'backslash'],
    ['/src/**', 'absolute'],
    ['./src/**', '. or .. segment'],
    ['src/../secrets/**', '. or .. segment'],
    ['**tests/**', 'inside a segment'],
    ['src/**.rs', 'inside a segment'],
  ])('refuses %s', (pattern, reason) => {
    expect(failureOf(() => parsePattern(pattern))).toMatchObject({
      input: 'paths-ignore',
      message: expect.stringContaining(reason),
    });
  });
});

describe('parsePatterns', () => {
  it('reads one pattern per line, skipping blank lines and # comments', () => {
    const value = [
      '# Fixtures hold fake credentials by design.',
      '  services/api/test-support/**  ',
      '',
      '**/fixtures/**\r',
      '   ',
    ].join('\n');

    expect(parsePatterns(value)).toEqual(['services/api/test-support/**', '**/fixtures/**']);
  });

  it('keeps a duplicate once, at its first position', () => {
    expect(parsePatterns('a/**\nb/**\na/**')).toEqual(['a/**', 'b/**']);
  });

  it('reads an empty input as no patterns', () => {
    expect(parsePatterns('')).toEqual([]);
  });

  it('names the offending line rather than the whole input', () => {
    expect(failureOf(() => parsePatterns('ok/**\n!bad/**'))?.message).toContain('"!bad/**"');
  });
});

describe('resolveOptions', () => {
  it('derives the category default setup writes', () => {
    expect(resolve()).toEqual({
      language: 'rust',
      excludeTestPaths: true,
      pathsIgnore: [],
      category: '/language:rust',
      upload: true,
    });
  });

  it('keeps an explicit category', () => {
    expect(resolve({ category: ' /language:rust/crates-api ' }).category).toBe('/language:rust/crates-api');
  });

  it.each(['has space', 'tab\there', 'x'.repeat(129), 'emoji-\u{1F600}'])('refuses the category %j', (category) => {
    expect(failureOf(() => resolve({ category }))?.input).toBe('category');
  });

  it('reports the language before any other input', () => {
    expect(failureOf(() => resolve({ language: 'go', upload: 'maybe' }))?.input).toBe('language');
  });
});
