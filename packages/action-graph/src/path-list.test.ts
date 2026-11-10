import { describe, expect, it } from 'vitest';

import { parsePathList } from './path-list.js';

describe('parsePathList', () => {
  it('reads a newline list, trimming and dropping blank lines', () => {
    expect(parsePathList('  ./actions/b\n\nactions/a\r\nactions/a\n')).toEqual(['actions/a', 'actions/b']);
  });

  it('reads a JSON array', () => {
    expect(parsePathList('["actions/b", "actions/a"]')).toEqual(['actions/a', 'actions/b']);
  });

  it('returns nothing for empty input', () => {
    expect(parsePathList('   ')).toEqual([]);
    expect(parsePathList('[]')).toEqual([]);
  });

  it.each([
    ['[1]', /must be a string/],
    ['[', /not a JSON array/],
    ['["a"', /not a JSON array/],
    ['../escape', /'\.\.' segment/],
    ['/abs', /is absolute/],
  ])('rejects %j', (text, message) => {
    expect(() => parsePathList(text, 'build directory')).toThrow(message);
  });
});
