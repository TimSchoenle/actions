import { describe, expect, it } from 'vitest';

import { parseMergeMethod } from './merge-method.js';

describe('parseMergeMethod', () => {
  it.each(['merge', 'rebase', 'squash'])('accepts %s', (method) => {
    expect(parseMergeMethod(method)).toBe(method);
  });

  it.each([
    ['an empty value', ''],
    ['an upper-case method', 'SQUASH'],
    ['a gh flag that bypasses branch protection', 'admin'],
    ['a flag with its dashes', '--squash'],
    ['an injected second flag', 'squash --admin'],
    ['surrounding whitespace', ' squash'],
    ['a GraphQL enum smuggled in', 'SQUASH) { x }'],
  ])('rejects %s', (_name, method) => {
    expect(() => parseMergeMethod(method)).toThrow(/Invalid 'merge_method'/);
  });
});
