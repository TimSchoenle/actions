import { describe, expect, it } from 'vitest';

import {
  fingerprintDiff,
  hasSoakMarker,
  parseSoakFrom,
  parseSoakMarker,
  renderSoakComment,
  unreadableDiffReason,
} from './soak.js';

import type { DiffFile } from './soak.js';

function file(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    filename: 'package.json',
    patch: '@@ -1,3 +1,3 @@\n {\n-  "x": "1.0.0"\n+  "x": "1.1.0"\n }',
    previousFilename: null,
    sha: 'd'.repeat(40),
    status: 'modified',
    ...overrides,
  };
}

describe('parseSoakFrom', () => {
  it.each(['opened', 'content'])('accepts %s', (value) => {
    expect(parseSoakFrom(value)).toBe(value);
  });

  it.each(['', 'Content', 'commit', ' opened'])('rejects %j', (value) => {
    expect(() => parseSoakFrom(value)).toThrow(/Invalid 'soak_from'/);
  });
});

describe('fingerprintDiff', () => {
  it('ignores hunk line numbers and context lines', () => {
    const moved = file({ patch: '@@ -90,4 +90,4 @@\n "other": 1,\n-  "x": "1.0.0"\n+  "x": "1.1.0"\n }\n' });

    expect(fingerprintDiff([moved])).toBe(fingerprintDiff([file()]));
  });

  it('changes when an added or removed line changes', () => {
    expect(fingerprintDiff([file({ patch: '-  "x": "1.0.0"\n+  "x": "1.2.0"' })])).not.toBe(fingerprintDiff([file()]));
  });

  it('ignores the order GitHub lists the files in', () => {
    const other = file({ filename: 'bun.lock' });

    expect(fingerprintDiff([file(), other])).toBe(fingerprintDiff([other, file()]));
  });

  it('changes when a file is added to the change', () => {
    expect(fingerprintDiff([file(), file({ filename: 'b' })])).not.toBe(fingerprintDiff([file()]));
  });

  it('changes when a file is renamed from a different path', () => {
    expect(fingerprintDiff([file({ previousFilename: 'a', status: 'renamed' })])).not.toBe(
      fingerprintDiff([file({ previousFilename: 'b', status: 'renamed' })]),
    );
  });

  it('identifies a file without a patch by its blob SHA', () => {
    const binary = (sha: string) => file({ patch: null, sha });

    expect(fingerprintDiff([binary('1'.repeat(40))])).toBe(fingerprintDiff([binary('1'.repeat(40))]));
    expect(fingerprintDiff([binary('1'.repeat(40))])).not.toBe(fingerprintDiff([binary('2'.repeat(40))]));
  });

  it('does not let a path collide with a patch line', () => {
    expect(fingerprintDiff([file({ filename: 'a', patch: '+b' })])).not.toBe(
      fingerprintDiff([file({ filename: 'a+b', patch: '' })]),
    );
  });
});

describe('unreadableDiffReason', () => {
  it('accepts a complete diff', () => {
    expect(unreadableDiffReason([file(), file({ patch: null })], false)).toBeUndefined();
  });

  it('rejects a list GitHub cut short', () => {
    expect(unreadableDiffReason([file()], true)).toMatch(/may have left some out/);
  });

  it('rejects a file with neither a patch nor a blob SHA', () => {
    expect(unreadableDiffReason([file({ filename: 'mod', patch: null, sha: null })], false)).toMatch(/"mod"/);
  });
});

describe('soak marker', () => {
  const marker = { fingerprint: 'f'.repeat(64), sinceMs: Date.parse('2026-11-01T10:00:00Z') };

  it('round-trips through the rendered comment', () => {
    const body = renderSoakComment(marker, '24h');

    expect(parseSoakMarker(body)).toEqual(marker);
    expect(hasSoakMarker(body)).toBe(true);
    expect(body).toContain('stayed the same for 24h');
  });

  it.each([
    ['no marker', 'just a comment'],
    ['a short fingerprint', '<!-- timed-auto-merge:soak v1 fingerprint=abc since=2026-11-01T10:00:00.000Z -->'],
    ['an unreadable time', `<!-- timed-auto-merge:soak v1 fingerprint=${'f'.repeat(64)} since=never -->`],
    ['another version', `<!-- timed-auto-merge:soak v2 fingerprint=${'f'.repeat(64)} since=2026-11-01T10:00:00Z -->`],
  ])('reads %s as no marker', (_label, body) => {
    expect(parseSoakMarker(body)).toBeUndefined();
  });

  it('recognises a broken marker as one, so it is rewritten in place', () => {
    expect(hasSoakMarker('<!-- timed-auto-merge:soak v1 broken -->')).toBe(true);
    expect(hasSoakMarker('timed-auto-merge:soak')).toBe(false);
  });
});
