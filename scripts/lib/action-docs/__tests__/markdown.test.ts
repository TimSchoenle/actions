import { describe, expect, it } from 'vitest';

import { codeSpan, collapseWhitespace, table, tableCell } from '../markdown.js';

describe('collapseWhitespace', () => {
  it('joins lines and squeezes runs of whitespace', () => {
    expect(collapseWhitespace('  one\n  two\t\tthree  ')).toBe('one two three');
  });
});

describe('tableCell', () => {
  it('escapes pipes so they do not split the cell', () => {
    expect(tableCell('a | b\nc')).toBe(String.raw`a \| b c`);
  });
});

describe('codeSpan', () => {
  it('uses a single backtick for plain text', () => {
    expect(codeSpan('x')).toBe('`x`');
  });

  it('widens the fence past the longest backtick run inside', () => {
    expect(codeSpan('a `b` c')).toBe('`` a `b` c ``');
    expect(codeSpan('``x``')).toBe('``` ``x`` ```');
  });
});

describe('table', () => {
  it('pads every column to its widest cell', () => {
    expect(table(['A', 'Long header'], [['wide cell', 'x']])).toBe(
      ['| A         | Long header |', '| --------- | ----------- |', '| wide cell | x           |'].join('\n'),
    );
  });

  it('keeps the delimiter row at least three dashes wide', () => {
    expect(table(['A'], [])).toBe('| A   |\n| --- |');
  });

  it('refuses a row with the wrong number of cells', () => {
    expect(() => table(['A', 'B'], [['only one']])).toThrow(/1 cells, expected 2/);
  });
});
