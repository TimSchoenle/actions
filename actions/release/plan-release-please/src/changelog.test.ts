import { describe, expect, it } from 'vitest';

import { extractReleaseNotes } from './changelog.js';

const CHANGELOG = `# Changelog

## [1.10.0](https://github.com/o/r/compare/src-x-v1.1.0...src-x-v1.10.0) (2026-11-09)


### Features

* **x:** add a thing ([#2](https://github.com/o/r/issues/2))

### Bug Fixes

* fix a thing

## [1.1.0](https://github.com/o/r/compare/src-x-v1.0.0...src-x-v1.1.0) (2026-11-01)

### Features

* older
`;

describe('extractReleaseNotes', () => {
  it('takes the section of the version, sub-headings included, up to the next release', () => {
    expect(extractReleaseNotes(CHANGELOG, '1.10.0', 'CHANGELOG.md')).toBe(
      '### Features\n\n* **x:** add a thing ([#2](https://github.com/o/r/issues/2))\n\n### Bug Fixes\n\n* fix a thing\n',
    );
  });

  it('matches the version as a whole token, not as part of another version or a compare link', () => {
    expect(extractReleaseNotes(CHANGELOG, '1.1.0', 'CHANGELOG.md')).toBe('### Features\n\n* older\n');
  });

  it('reads a plain heading and Windows line endings', () => {
    expect(extractReleaseNotes('# Changelog\r\n\r\n## 2.0.0 (2026-01-01)\r\n\r\n* change\r\n', '2.0.0', 'C')).toBe(
      '* change\n',
    );
  });

  it('fails when no heading names the version', () => {
    expect(() => extractReleaseNotes(CHANGELOG, '1.0.0', 'actions/x/CHANGELOG.md')).toThrow(
      /actions\/x\/CHANGELOG\.md has no heading for version 1\.0\.0/,
    );
  });

  it('fails on an empty section', () => {
    expect(() => extractReleaseNotes('## 1.0.0\n\n## 0.9.0\n* x\n', '1.0.0', 'C')).toThrow(/empty section/);
  });
});
