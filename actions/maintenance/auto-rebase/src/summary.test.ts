import { describe, expect, it } from 'vitest';

import { renderSummary } from './summary.js';

import type { UpdateResult } from './update.js';

function result(overrides: Partial<UpdateResult> = {}): UpdateResult {
  return { failed: [], matched: [], skipped: [], updated: [], ...overrides };
}

describe('renderSummary', () => {
  it('says so when no pull request carries the label', () => {
    expect(renderSummary(result(), 'owner/repo', 'dependencies')).toBe(
      '### Branch updates for `dependencies` in `owner/repo`\n\nNo open pull request carries the label.\n',
    );
  });

  it('renders one row per pull request, grouped by outcome', () => {
    const markdown = renderSummary(
      result({
        failed: [
          { kind: 'rejected', message: 'merge conflict', number: 4 },
          { kind: 'error', message: 'Forbidden', number: 5 },
        ],
        matched: [1, 2, 3, 4, 5],
        skipped: [
          { number: 2, reason: 'up-to-date' },
          { number: 3, reason: 'draft' },
        ],
        updated: [1],
      }),
      'owner/repo',
      'dependencies',
    );

    expect(markdown.split('\n').filter((line) => line.startsWith('| #'))).toEqual([
      '| #1 | updated | update requested |',
      '| #2 | skipped | already contains its base |',
      '| #3 | skipped | draft, and skip_drafts is set |',
      '| #4 | rejected | `merge conflict` |',
      '| #5 | failed | `Forbidden` |',
    ]);
  });

  it('keeps a hostile label and error message inside their cells', () => {
    const markdown = renderSummary(
      result({ failed: [{ kind: 'error', message: 'a|b\n| x |', number: 1 }], matched: [1] }),
      'owner/repo',
      'dep`s\n# heading',
    );

    expect(markdown).toContain('### Branch updates for `dep s # heading`');
    expect(markdown).toContain('| #1 | failed | `a b   x` |');
    expect(markdown).not.toMatch(/^# heading/m);
  });

  it('marks an empty message and clips a long one', () => {
    const markdown = renderSummary(
      result({
        failed: [
          { kind: 'error', message: '', number: 1 },
          { kind: 'error', message: 'm'.repeat(300), number: 2 },
        ],
      }),
      'o/r',
      'l',
    );

    expect(markdown).toContain('| #1 | failed | (empty) |');
    expect(markdown).toContain(`\`${'m'.repeat(200)}...\``);
  });
});
