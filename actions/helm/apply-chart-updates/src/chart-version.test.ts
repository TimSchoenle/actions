import { describe, expect, it } from 'vitest';

import { assertSemver, bumpChartVersion, InvalidVersionError, parseBumpKind } from './chart-version.js';

describe('bumpChartVersion', () => {
  it.each([
    ['1.2.3', 'patch', '1.2.4'],
    ['1.0.0', 'patch', '1.0.1'],
    ['10.20.99', 'patch', '10.20.100'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'major', '2.0.0'],
    ['1.2.3', 'none', '1.2.3'],
  ] as const)('bumps %s by %s to %s', (current, kind, expected) => {
    expect(bumpChartVersion(current, kind)).toBe(expected);
  });

  // The `awk` predecessor incremented the last dot-separated field, turning `1.2.3-rc.1` into
  // `1.2.3-rc.2` — not a release of anything.
  it.each([
    ['1.2.3-rc.1', 'patch', '1.2.3'],
    ['1.3.0-rc.1', 'minor', '1.3.0'],
    ['1.3.1-rc.1', 'minor', '1.4.0'],
    ['2.0.0-rc.1', 'major', '2.0.0'],
    ['2.1.0-rc.1', 'major', '3.0.0'],
  ] as const)('releases the prerelease %s on a %s bump, giving %s', (current, kind, expected) => {
    expect(bumpChartVersion(current, kind)).toBe(expected);
  });

  it('drops build metadata, which describes the build rather than the release', () => {
    expect(bumpChartVersion('1.2.3+build.7', 'patch')).toBe('1.2.4');
  });

  it.each(['1.2', 'v1.2.3', '1.2.3.4', '', 'latest'])('rejects the non-SemVer version %s', (version) => {
    expect(() => bumpChartVersion(version, 'patch')).toThrow(InvalidVersionError);
  });
});

describe('parseBumpKind', () => {
  it.each(['patch', 'minor', 'major', 'none'])('accepts %s', (kind) => {
    expect(parseBumpKind(kind)).toBe(kind);
  });

  it('tolerates surrounding whitespace from a YAML block scalar', () => {
    expect(parseBumpKind(' patch ')).toBe('patch');
  });

  it.each(['', 'PATCH', 'bump'])('rejects %s', (kind) => {
    expect(() => parseBumpKind(kind)).toThrow(InvalidVersionError);
  });
});

describe('assertSemver', () => {
  it('returns the version unchanged', () => {
    expect(assertSemver('1.2.3-rc.1+build', 'chart-version')).toBe('1.2.3-rc.1+build');
  });

  it('names the input it rejected', () => {
    expect(() => assertSemver('nope', 'chart-version')).toThrow(/chart-version 'nope'/);
  });
});
