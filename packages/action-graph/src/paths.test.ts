import { describe, expect, it } from 'vitest';

import { InvalidPathError, isWithin, joinRepoPath, parentOf, sortedUnique, toAbsolute, toRepoPath } from './paths.js';

describe('toRepoPath', () => {
  it.each([
    ['actions/a', 'actions/a'],
    ['./actions/a/', 'actions/a'],
    ['actions\\a\\dist', 'actions/a/dist'],
    ['actions//a/./b', 'actions/a/b'],
    ['.', '.'],
    ['./', '.'],
  ])('normalises %j to %j', (input, expected) => {
    expect(toRepoPath(input)).toBe(expected);
  });

  it.each(['', '  ', '/etc/passwd', 'C:/x', 'c:\\x', '../x', 'a/../b', 'a/..', 'a\u0000b', 'a\nb'])(
    'rejects %j',
    (input) => {
      expect(() => toRepoPath(input)).toThrow(InvalidPathError);
    },
  );

  it('names the value in the message', () => {
    expect(() => toRepoPath('../x', 'build directory')).toThrow(/build directory "\.\.\/x"/);
  });
});

describe('joinRepoPath', () => {
  it('treats the root as empty', () => {
    expect(joinRepoPath('.', 'dist/index.js')).toBe('dist/index.js');
    expect(joinRepoPath('actions/a', 'dist/index.js')).toBe('actions/a/dist/index.js');
  });

  it('refuses to climb above the root', () => {
    expect(() => joinRepoPath('actions', '../../x')).toThrow(InvalidPathError);
  });
});

describe('parentOf and isWithin', () => {
  it('returns the root for a top-level file', () => {
    expect(parentOf('README.md')).toBe('.');
    expect(parentOf('a/b/c')).toBe('a/b');
  });

  it('compares by segment', () => {
    expect(isWithin('actions/a', 'actions/a')).toBe(true);
    expect(isWithin('actions/a', 'actions/a/dist/index.js')).toBe(true);
    expect(isWithin('actions/a', 'actions/ab/index.js')).toBe(false);
    expect(isWithin('.', 'anything')).toBe(true);
  });
});

describe('toAbsolute and sortedUnique', () => {
  it('joins under the root', () => {
    expect(toAbsolute('/r', '.')).toBe('/r');
    expect(toAbsolute('/r', 'a/b').replaceAll('\\', '/')).toBe('/r/a/b');
  });

  it('sorts by code unit and removes duplicates', () => {
    expect(sortedUnique(['b', 'B', 'a', 'b'])).toEqual(['B', 'a', 'b']);
  });
});
