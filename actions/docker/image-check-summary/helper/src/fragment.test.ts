import { describe, expect, it } from 'vitest';

// The writer's own function, imported across the action boundary on purpose: this is the contract
// between the two actions, and a fixture written by hand here could agree with a parser that no
// longer agrees with what image-check actually uploads.
import { toFragment } from '../../../image-check/helper/src/render.js';
import { collectFragments, InvalidFragmentError, parseFragment, parseFragmentText } from './fragment.js';

import type { ImageFragment } from './fragment.js';

const WRITTEN = {
  version: 1,
  platform: 'linux/amd64',
  image: 'app:test',
  size_bytes: 91_645_132,
  warning_mib: 150,
  findings: 3,
  severity: 'CRITICAL,HIGH',
};

function fragment(platform: string, overrides: Partial<ImageFragment> = {}): ImageFragment {
  return {
    platform,
    image: 'app:test',
    sizeBytes: 1,
    warningMib: 150,
    findings: 0,
    severity: 'CRITICAL,HIGH',
    ...overrides,
  };
}

describe('parseFragment', () => {
  it('reads what docker/image-check writes', () => {
    const written = toFragment({
      image: 'app:test',
      platform: 'linux/arm64',
      sizeBytes: 5,
      warningMib: 150,
      limitMib: 300,
      severity: 'CRITICAL',
      findings: 2,
    });

    expect(parseFragment(JSON.parse(JSON.stringify(written)), 'a')).toEqual({
      platform: 'linux/arm64',
      image: 'app:test',
      sizeBytes: 5,
      warningMib: 150,
      findings: 2,
      severity: 'CRITICAL',
    });
  });

  it.each(['platform', 'image', 'size_bytes', 'warning_mib', 'findings', 'severity'])(
    'refuses a fragment missing %s, naming the field',
    (field) => {
      const incomplete: Record<string, unknown> = { ...WRITTEN };
      delete incomplete[field];

      expect(() => parseFragment(incomplete, 'image-check-linux-amd64')).toThrow(
        new RegExp(`image-check-linux-amd64.*'${field}'`),
      );
    },
  );

  it.each([
    ['a non-numeric size', { size_bytes: '91645132' }],
    ['a fractional size', { size_bytes: 1.5 }],
    ['a negative findings count', { findings: -1 }],
    ['a negative warning', { warning_mib: -1 }],
    ['an unknown severity', { severity: 'SEVERE' }],
    ['a platform that would break out of a code span', { platform: 'linux/`amd64`' }],
    ['an image that would break out of a table cell', { image: 'app|test' }],
    ['an image with a line break', { image: 'app\ntest' }],
    ['another schema version', { version: 2 }],
  ])('refuses %s', (_case, overrides) => {
    expect(() => parseFragment({ ...WRITTEN, ...overrides }, 'x')).toThrow(InvalidFragmentError);
  });

  it('refuses text that is not JSON', () => {
    expect(() => parseFragmentText('{', 'x')).toThrow('not valid JSON');
  });
});

describe('collectFragments', () => {
  it('sorts by platform, so the table does not move with job finish times', () => {
    const { fragments } = collectFragments([
      fragment('linux/arm64'),
      fragment('linux/amd64'),
      fragment('linux/arm/v7'),
    ]);

    expect(fragments.map((item) => item.platform)).toEqual(['linux/amd64', 'linux/arm/v7', 'linux/arm64']);
  });

  it('keeps the last of two fragments for one platform, and names the platform', () => {
    const { fragments, duplicates } = collectFragments([
      fragment('linux/amd64', { findings: 1 }),
      fragment('linux/amd64', { findings: 2 }),
      fragment('linux/amd64', { findings: 3 }),
    ]);

    expect(fragments).toEqual([fragment('linux/amd64', { findings: 3 })]);
    expect(duplicates).toEqual(['linux/amd64']);
  });

  it('reports no duplicates when there are none', () => {
    expect(collectFragments([fragment('a'), fragment('b')]).duplicates).toEqual([]);
  });
});
