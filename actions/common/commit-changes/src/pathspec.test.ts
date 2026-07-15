import { describe, expect, it } from 'vitest';

import { buildPathspecs } from './pathspec.js';

describe('buildPathspecs', () => {
  it.each(['', '.'])('treats %j as the whole tree and disables filtering', (pattern) => {
    expect(buildPathspecs(pattern)).toEqual({ specs: [], useFilter: false });
  });

  it('passes a literal path through untouched', () => {
    expect(buildPathspecs('src/index.ts')).toEqual({ specs: ['src/index.ts'], useFilter: true });
  });

  it('wraps a wildcard pattern in :(glob) so * crosses path separators', () => {
    expect(buildPathspecs('src/**/*.ts')).toEqual({ specs: [':(glob)src/**/*.ts'], useFilter: true });
  });

  it.each(['a*', 'a?', 'a[bc]'])('treats %j as a glob', (pattern) => {
    expect(buildPathspecs(pattern).specs).toEqual([`:(glob)${pattern}`]);
  });

  it('leaves an already-magic pathspec alone', () => {
    expect(buildPathspecs(':(glob)src/**').specs).toEqual([':(glob)src/**']);
    expect(buildPathspecs(':!vendor').specs).toEqual([':!vendor']);
  });

  it('splits multiple space-separated patterns and classifies each', () => {
    expect(buildPathspecs('Chart.yaml values/*.yaml')).toEqual({
      specs: ['Chart.yaml', ':(glob)values/*.yaml'],
      useFilter: true,
    });
  });

  it('collapses runs of whitespace and ignores empty fragments', () => {
    expect(buildPathspecs('  a   b  ').specs).toEqual(['a', 'b']);
  });

  it('disables filtering when the pattern is only whitespace', () => {
    expect(buildPathspecs('   ')).toEqual({ specs: [], useFilter: false });
  });
});
