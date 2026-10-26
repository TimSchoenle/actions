import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import { escapeCell, renderSummary, toOutputs } from './report.js';

import type { PullRequestOutcome } from './process.js';

const HEAD = 'a'.repeat(40);

const OUTCOMES: PullRequestOutcome[] = [
  { headRef: 'release-please--branches--main', headSha: HEAD, number: 1, status: 'approved' },
  {
    detail: 'open for 3h, needs 24h',
    headRef: 'release-please--branches--next',
    number: 2,
    reason: 'too-young',
    status: 'skipped',
  },
  { headRef: 'release-please--branches--x', message: 'Bad credentials', number: 3, status: 'failed' },
  { headRef: 'release-please--branches--y', headSha: HEAD, number: 4, status: 'approved' },
];

describe('toOutputs', () => {
  it('splits the outcomes into three JSON lists', () => {
    expect(toOutputs(OUTCOMES)).toEqual({
      approved: '[1,4]',
      failed: '[{"message":"Bad credentials","number":3}]',
      skipped: '[{"number":2,"reason":"too-young"}]',
    });
  });

  it('publishes empty lists, not empty strings, when nothing matched', () => {
    expect(toOutputs([])).toEqual({ approved: '[]', failed: '[]', skipped: '[]' });
  });
});

describe('escapeCell', () => {
  it.each([
    ['a pipe that would split the row', 'a|b', 'a&#124;b'],
    ['markup', '<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;'],
    ['a link', '[click](https://evil.example)', '&#91;click&#93;(https://evil.example)'],
    ['a newline that would end the table', 'a\n| forged | row |', 'a &#124; forged &#124; row &#124;'],
    ['an existing entity', '&lt;', '&amp;lt;'],
    ['emphasis', '*bold* _it_', '&#42;bold&#42; &#95;it&#95;'],
    ['a backslash escape', '\\|', '&#92;&#124;'],
    ['code', '`x`', '&#96;x&#96;'],
  ])('neutralises %s', (_name, input, expected) => {
    expect(escapeCell(input)).toBe(expected);
  });

  test.prop([fc.string()])('never leaves a character that could break out of the cell', (input) => {
    expect(escapeCell(input)).not.toMatch(/[\n\r|<>[\]`]/);
  });
});

describe('renderSummary', () => {
  it('renders one row per matching pull request', () => {
    expect(renderSummary({ openCount: 9, outcomes: OUTCOMES }, '^(?:release-please--branches--.*)')).toBe(
      [
        '## Timed auto-merge',
        '',
        '4 of 9 open pull request(s) matched ^(?:release-please--branches--.&#42;).',
        '',
        '| Pull request | Branch | Result | Detail |',
        '| --- | --- | --- | --- |',
        `| #1 | release-please--branches--main | approved | approved at ${HEAD}, auto-merge enabled |`,
        '| #2 | release-please--branches--next | skipped (too-young) | open for 3h, needs 24h |',
        '| #3 | release-please--branches--x | failed | Bad credentials |',
        `| #4 | release-please--branches--y | approved | approved at ${HEAD}, auto-merge enabled |`,
        '',
      ].join('\n'),
    );
  });

  it('omits the table when nothing matched', () => {
    expect(renderSummary({ openCount: 3, outcomes: [] }, 'x')).toBe(
      '## Timed auto-merge\n\n0 of 3 open pull request(s) matched x.\n',
    );
  });

  it('escapes a hostile branch name', () => {
    const summary = renderSummary(
      { openCount: 1, outcomes: [{ detail: 'd', headRef: 'x|<b>', number: 1, reason: 'draft', status: 'skipped' }] },
      'x',
    );

    expect(summary).toContain('| x&#124;&lt;b&gt; |');
  });
});
