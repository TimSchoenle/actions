import { describe, expect, it } from 'vitest';

import { formatBytes, MAX_ROWS, renderSummary } from './summary.js';

import type { CacheEntry } from './github-api.js';
import type { WipeResult } from './wipe.js';

function entry(id: number, key = `key-${id}`): CacheEntry {
  return { id, key, ref: 'refs/heads/x', sizeInBytes: 2048 };
}

function result(overrides: Partial<WipeResult> = {}): WipeResult {
  return { alreadyGone: [], deleted: [], failures: [], matched: [], rounds: 1, stopReason: 'empty', ...overrides };
}

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KiB'],
    [1536, '1.5 KiB'],
    [5 * 1024 ** 3, '5.0 GiB'],
    [3 * 1024 ** 5, '3072.0 TiB'],
  ])('renders %d bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('renderSummary', () => {
  it('renders the counts and the freed size', () => {
    const markdown = renderSummary(
      result({ alreadyGone: [entry(3)], deleted: [entry(1), entry(2)], matched: [entry(1), entry(2), entry(3)] }),
      'owner/repo',
      'refs/heads/x',
      false,
    );

    expect(markdown).toContain('### Cache wipe for `refs/heads/x` in `owner/repo`');
    expect(markdown).toContain('| 3 | 2 | 1 | 0 | 4.0 KiB |');
    expect(markdown).toContain('No cache entries are left for the branch.');
    expect(markdown).not.toContain('Would delete');
    expect(markdown).not.toContain('Not deleted');
  });

  it('lists what a dry run would delete', () => {
    const markdown = renderSummary(
      result({ matched: [entry(1)], stopReason: 'dry-run' }),
      'owner/repo',
      'refs/heads/x',
      true,
    );

    expect(markdown).toContain('Dry run: nothing was deleted.');
    expect(markdown).toContain('#### Would delete');
    expect(markdown).toContain('| `key-1` | 1 | 2.0 KiB |');
  });

  it('lists the entries that could not be deleted, with the reason', () => {
    const markdown = renderSummary(
      result({ failures: [{ entry: entry(9), message: 'Forbidden' }], matched: [entry(9)], stopReason: 'no-progress' }),
      'owner/repo',
      'refs/heads/x',
      false,
    );

    expect(markdown).toContain('#### Not deleted');
    expect(markdown).toContain('| `key-9` | 9 | `Forbidden` |');
    expect(markdown).toContain('A round deleted nothing');
  });

  it('names the round limit', () => {
    expect(renderSummary(result({ stopReason: 'round-limit' }), 'o/r', 'refs/heads/x', false)).toContain(
      'after 10 rounds',
    );
  });

  // Keys are chosen by whichever workflow saved the cache.
  it('keeps a hostile key inside its table cell', () => {
    const markdown = renderSummary(
      result({ matched: [entry(1, 'a|b`c\n| injected |\r')], stopReason: 'dry-run' }),
      'o/r',
      'refs/heads/x',
      true,
    );
    const row = markdown.split('\n').find((line) => line.endsWith('| 1 | 2.0 KiB |'));

    expect(row).toBe('| `a b c   injected` | 1 | 2.0 KiB |');
  });

  it('marks an empty key instead of rendering an empty code span', () => {
    const markdown = renderSummary(result({ matched: [entry(1, '')] }), 'o/r', 'refs/heads/x', true);

    expect(markdown).toContain('| (empty) | 1 |');
  });

  it('clips a long key', () => {
    const markdown = renderSummary(result({ matched: [entry(1, 'k'.repeat(500))] }), 'o/r', 'refs/heads/x', true);

    expect(markdown).toContain(`\`${'k'.repeat(120)}...\``);
  });

  it(`shows at most ${MAX_ROWS} rows per table and counts the rest`, () => {
    const many = Array.from({ length: MAX_ROWS + 7 }, (_, index) => entry(index + 1));
    const markdown = renderSummary(
      result({ failures: many.map((cache) => ({ entry: cache, message: 'x' })), matched: many }),
      'o/r',
      'refs/heads/x',
      true,
    );

    expect(markdown.match(/^\| `key-\d+` \|/gm)).toHaveLength(2 * MAX_ROWS);
    expect(markdown.match(/7 more not shown\./g)).toHaveLength(2);
  });
});
