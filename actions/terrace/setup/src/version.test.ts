import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import { formatVersion, isExact, parseReleaseTag, parseVersionRequest } from './version.js';

import type { ReleaseVersion } from './version.js';

describe('parseVersionRequest', () => {
  it.each([
    ['0.8', { major: 0, minor: 8 }],
    ['0.8.0', { major: 0, minor: 8, patch: 0 }],
    ['12.34.56', { major: 12, minor: 34, patch: 56 }],
    [' 1.2 ', { major: 1, minor: 2 }],
  ])('reads %j', (text, expected) => {
    expect(parseVersionRequest(text)).toEqual(expected);
  });

  it.each(['', '1', 'v0.8.0', '0.8.0-rc.1', '01.2', '1.02', '1.2.3.4', '1.x', '0.8.'])('refuses %j', (text) => {
    expect(parseVersionRequest(text)).toBeUndefined();
  });

  test.prop([fc.nat(999), fc.nat(999), fc.option(fc.nat(999), { nil: undefined })])(
    'round-trips through formatVersion',
    (major, minor, patch) => {
      const request = patch === undefined ? { major, minor } : { major, minor, patch };

      expect(parseVersionRequest(formatVersion(request))).toEqual(request);
    },
  );
});

describe('parseReleaseTag', () => {
  it('reads a terrace-contract release tag', () => {
    expect(parseReleaseTag('terrace-contract-v0.8.0')).toEqual({ major: 0, minor: 8, patch: 0 });
  });

  it.each(['v0.15.2', 'terrace-config-java-v0.6.2', 'terrace-contract-v0.8.0-rc.1', 'terrace-contract-v0.8'])(
    'ignores %j',
    (tag) => {
      expect(parseReleaseTag(tag)).toBeUndefined();
    },
  );
});

describe('isExact', () => {
  it('marks only a patch-bearing request as exact', () => {
    expect(isExact({ major: 0, minor: 8, patch: 0 })).toBe(true);
    expect(isExact({ major: 0, minor: 8 })).toBe(false);
  });
});
