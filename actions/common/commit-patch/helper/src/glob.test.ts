import { fc, it as prop } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import { compileAllowlist, GlobSyntaxError } from './glob.js';

/** True when `path` matches the single `pattern`. */
function matches(pattern: string, path: string): boolean {
  return compileAllowlist(pattern).matches(path);
}

describe('compileAllowlist', () => {
  it.each([
    ['README.md', 'README.md', true],
    ['README.md', 'docs/README.md', false],
    ['README.md', 'README.mdx', false],
    ['*.md', 'README.md', true],
    ['*.md', 'docs/README.md', false],
    ['*', '.hidden', true],
    ['?.txt', 'a.txt', true],
    ['?.txt', 'ab.txt', false],
    ['?.txt', '/.txt', false],
    ['dist/**', 'dist/index.js', true],
    ['dist/**', 'dist/a/b/c.js', true],
    ['dist/**', 'dist', false],
    ['dist/**', 'distx/a.js', false],
    ['**/index.js', 'index.js', true],
    ['**/index.js', 'a/b/index.js', true],
    ['**/index.js', 'a/b/index.jsx', false],
    ['actions/**/dist/**', 'actions/common/x/dist/index.js', true],
    ['actions/**/dist/**', 'actions/dist/index.js', true],
    ['actions/**/dist/**', 'actions/common/x/src/index.ts', false],
    ['actions/*/*/dist/**', 'actions/common/x/dist/index.js', true],
    ['actions/*/*/dist/**', 'actions/common/x/y/dist/index.js', false],
    ['.github/workflows/verify-action-*.yaml', '.github/workflows/verify-action-common-read-yaml.yaml', true],
    ['.github/workflows/verify-action-*.yaml', '.github/workflows/verify-action-x.yaml.bak', false],
    ['.github/workflows/verify-action-*.yaml', '.github/workflows/release.yaml', false],
    ['a.b', 'axb', false],
    ['a+b', 'a+b', true],
    ['(x)|y', '(x)|y', true],
    ['(x)|y', 'y', false],
    ['$^', '$^', true],
    ['**', 'anything/at/all', true],
  ])('%j against %j is %s', (pattern, path, expected) => {
    expect(matches(pattern, path)).toBe(expected);
  });

  it('is case-sensitive, as git paths are', () => {
    expect(matches('README.md', 'readme.md')).toBe(false);
  });

  it('matches when any one of several whitespace-separated patterns does', () => {
    const allowlist = compileAllowlist('README.md\n  SECURITY.md\tdocs/**');

    expect(allowlist.patterns).toEqual(['README.md', 'SECURITY.md', 'docs/**']);
    expect(allowlist.matches('SECURITY.md')).toBe(true);
    expect(allowlist.matches('docs/a/b.md')).toBe(true);
    expect(allowlist.matches('LICENSE')).toBe(false);
  });

  it.each([
    ['an empty list', '   \n '],
    ['a character class', 'src/[ab].ts'],
    ['a brace expansion', 'src/{a,b}.ts'],
    ['a negation', '!dist/**'],
    ['an escape', String.raw`a\*b`],
    ['an absolute pattern', '/etc/passwd'],
    ['a traversal', 'dist/../secrets'],
    ['a dot segment', './README.md'],
    ['an empty segment', 'dist//index.js'],
    ['a trailing slash', 'dist/'],
    ['** inside a segment', 'dist/**.js'],
    ['an overlong pattern', 'a'.repeat(1025)],
  ])('refuses %s', (_name, pattern) => {
    expect(() => compileAllowlist(pattern)).toThrow(GlobSyntaxError);
  });

  prop.prop([fc.stringMatching(/^[a-z0-9._-]{1,12}(\/[a-z0-9._-]{1,12}){0,4}$/)])(
    'matches a literal pattern against exactly the same path',
    (path) => {
      fc.pre(!path.split('/').some((segment) => segment === '.' || segment === '..'));

      expect(matches(path, path)).toBe(true);
      expect(matches(path, `${path}x`)).toBe(false);
      expect(matches(path, `x/${path}`)).toBe(false);
    },
  );

  prop.prop([fc.stringMatching(/^[a-z0-9._-]{1,12}(\/[a-z0-9._-]{1,12}){0,4}$/)])(
    'never lets * cross a separator',
    (path) => {
      expect(matches('*', path)).toBe(!path.includes('/'));
    },
  );
});
