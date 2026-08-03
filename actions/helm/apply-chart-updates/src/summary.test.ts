import { describe, expect, it } from 'vitest';

import { renderChangelogSection, renderSummaryTable } from './summary.js';

describe('renderSummaryTable', () => {
  it('renders one row per image, in caller order', () => {
    const table = renderSummaryTable([
      { key: 'services.api.image.tag', old: 'v0.4.1@sha256:aaa', new: 'v1.0.0@sha256:111' },
      { key: 'services.worker.image.tag', old: 'v0.4.1@sha256:bbb', new: 'v0.9.4@sha256:222' },
    ]);

    expect(table.split('\n')).toEqual([
      '| Key | From | To |',
      '| --- | --- | --- |',
      '| `services.api.image.tag` | `v0.4.1@sha256:aaa` | `v1.0.0@sha256:111` |',
      '| `services.worker.image.tag` | `v0.4.1@sha256:bbb` | `v0.9.4@sha256:222` |',
    ]);
  });

  // New values are charset-validated; old ones come out of the chart and are arbitrary YAML.
  it('keeps a hostile previous value inside its cell', () => {
    const table = renderSummaryTable([{ key: 'image.tag', old: 'a|b`c\nd', new: 'v1' }]);

    expect(table.split('\n')).toHaveLength(3);
    expect(table).toContain('| `a b c d` |');
  });

  it('clips an over-long value', () => {
    const table = renderSummaryTable([{ key: 'image.tag', old: 'x'.repeat(200), new: 'v1' }]);

    expect(table).toContain(`\`${'x'.repeat(120)}…\``);
  });

  it('describes an empty update rather than rendering an empty table', () => {
    expect(renderSummaryTable([])).toBe('_No image values were changed._');
  });
});

describe('renderChangelogSection', () => {
  it('collapses the changelog into a details block', () => {
    expect(renderChangelogSection('## Features\n\n- a thing')).toBe(
      '<details>\n<summary>Changelog</summary>\n\n## Features\n\n- a thing\n\n</details>',
    );
  });

  // Embedding the section unconditionally must not leave an empty heading in the body.
  it('renders nothing at all when there is no changelog', () => {
    expect(renderChangelogSection('')).toBe('');
  });
});
