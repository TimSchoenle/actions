import { describe, expect, it } from 'vitest';

import { parseRawDiff, RawDiffFormatError } from './raw-diff.js';

const ZERO = '0'.repeat(40);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('parseRawDiff', () => {
  it('returns nothing for empty output', () => {
    expect(parseRawDiff('')).toEqual([]);
  });

  it('parses additions, modifications and deletions', () => {
    const output = [
      `:000000 100644 ${ZERO} ${A} A`,
      'new.txt',
      `:100644 100644 ${A} ${B} M`,
      'dir/changed.txt',
      `:100644 000000 ${B} ${ZERO} D`,
      'gone.txt',
      '',
    ].join('\0');

    expect(parseRawDiff(output)).toEqual([
      { dstMode: '100644', dstSha: A, path: 'new.txt', srcMode: '000000', srcSha: ZERO, status: 'A' },
      { dstMode: '100644', dstSha: B, path: 'dir/changed.txt', srcMode: '100644', srcSha: A, status: 'M' },
      { dstMode: '000000', dstSha: ZERO, path: 'gone.txt', srcMode: '100644', srcSha: B, status: 'D' },
    ]);
  });

  it('keeps a path with spaces, tabs and newlines intact', () => {
    const path = 'a dir/with\ttab\nand newline.txt';

    expect(parseRawDiff(`:000000 100644 ${ZERO} ${A} A\0${path}\0`)[0]?.path).toBe(path);
  });

  it('accepts SHA-256 object names', () => {
    const long = 'c'.repeat(64);

    expect(parseRawDiff(`:000000 100644 ${'0'.repeat(64)} ${long} A\0x\0`)[0]?.dstSha).toBe(long);
  });

  it('reads both paths of a rename and keeps the destination, so the fields stay aligned', () => {
    const output = [`:100644 100644 ${A} ${A} R100`, 'old', 'new', `:000000 100644 ${ZERO} ${B} A`, 'next', ''].join(
      '\0',
    );

    expect(parseRawDiff(output).map(({ path, status }) => ({ path, status }))).toEqual([
      { path: 'new', status: 'R' },
      { path: 'next', status: 'A' },
    ]);
  });

  it.each([
    ['a header without the leading colon', `000000 100644 ${ZERO} ${A} A\0x\0`],
    ['an abbreviated object name', `:000000 100644 0000000 aaaaaaa A\0x\0`],
    ['a non-octal mode', `:000000 100648 ${ZERO} ${A} A\0x\0`],
    ['a record cut short', `:000000 100644 ${ZERO} ${A} A\0`],
    ['a rename missing its second path', `:100644 100644 ${A} ${A} R100\0old\0`],
    ['an empty path', `:000000 100644 ${ZERO} ${A} A\0\0`],
  ])('refuses %s', (_name, output) => {
    expect(() => parseRawDiff(output)).toThrow(RawDiffFormatError);
  });
});
