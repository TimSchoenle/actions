import { describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import { parseBoolean, parseMebibytes, parseSeverity, platformSlug, resolveOptions } from './options.js';

import type { RawInputs } from './options.js';

const DEFAULTS: RawInputs = {
  image: 'app:test',
  platform: '',
  sizeWarningMib: '150',
  sizeLimitMib: '0',
  trivySeverity: 'CRITICAL,HIGH',
  trivyIgnoreUnfixed: 'false',
  trivyFailOnFindings: 'false',
  trivyIgnoreFile: '',
  uploadSarif: 'true',
  sarifCategory: '',
  comment: 'per-image',
  commentIdentifier: '',
};

const acceptAnyPath = (value: string): string => value;

function resolve(overrides: Partial<RawInputs> = {}, resolvePath = acceptAnyPath) {
  return resolveOptions({ ...DEFAULTS, ...overrides }, resolvePath);
}

function inputOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof InvalidInputError ? error.input : `unexpected ${String(error)}`;
  }

  return undefined;
}

describe('platformSlug', () => {
  it.each([
    ['', ''],
    ['linux/amd64', 'linux-amd64'],
    ['linux/arm/v7', 'linux-arm-v7'],
    ['Linux/ARM64', 'linux-arm64'],
  ])('turns %j into %j', (platform, slug) => {
    expect(platformSlug(platform)).toBe(slug);
  });
});

describe('resolveOptions', () => {
  it('derives nothing platform-specific without a platform', () => {
    const options = resolve();

    expect(options).toMatchObject({
      platform: '',
      slug: '',
      sarifCategory: '',
      commentIdentifier: 'docker-image-size',
      warningMib: 150,
      limitMib: 0,
    });
  });

  it('derives the category and identifier from the platform slug', () => {
    const options = resolve({ platform: 'linux/ARM64' });

    expect(options).toMatchObject({
      platform: 'linux/ARM64',
      slug: 'linux-arm64',
      sarifCategory: 'trivy-linux-arm64',
      commentIdentifier: 'docker-image-size-linux-arm64',
    });
  });

  it('keeps an explicit category and identifier over the derived ones', () => {
    const options = resolve({
      platform: 'linux/amd64',
      sarifCategory: 'trivy-amd64',
      commentIdentifier: 'docker-image-size-amd64',
    });

    expect(options.sarifCategory).toBe('trivy-amd64');
    expect(options.commentIdentifier).toBe('docker-image-size-amd64');
  });

  it('trims the image reference', () => {
    expect(resolve({ image: '  ghcr.io/acme/app:1.0  ' }).image).toBe('ghcr.io/acme/app:1.0');
  });

  it.each([
    ['image', { image: '' }],
    ['image', { image: '--help' }],
    ['platform', { platform: 'linux amd64' }],
    ['platform', { platform: 'linux//amd64' }],
    ['platform', { platform: 'a/b/c/d/e' }],
    ['platform', { platform: `linux/${'x'.repeat(40)}` }],
    ['size-warning-mib', { sizeWarningMib: '-1' }],
    ['size-warning-mib', { sizeWarningMib: '150MB' }],
    ['size-limit-mib', { sizeLimitMib: '' }],
    ['trivy-severity', { trivySeverity: 'CRITICAL,SEVERE' }],
    ['trivy-ignore-unfixed', { trivyIgnoreUnfixed: 'yes' }],
    ['trivy-fail-on-findings', { trivyFailOnFindings: '1' }],
    ['upload-sarif', { uploadSarif: 'on' }],
    ['comment', { comment: 'always' }],
    ['comment-identifier', { commentIdentifier: 'has space' }],
    ['comment-identifier', { commentIdentifier: 'x'.repeat(65) }],
    ['sarif-category', { sarifCategory: 'two words' }],
    ['trivy-ignore-file', { trivyIgnoreFile: 'a,b' }],
    ['trivy-ignore-file', { trivyIgnoreFile: 'my ignores' }],
    ['trivy-ignore-file', { trivyIgnoreFile: '*.trivyignore' }],
  ] satisfies [string, Partial<RawInputs>][])('rejects %s for %j', (input, overrides) => {
    expect(inputOf(() => resolve(overrides))).toBe(input);
  });

  it('requires a platform in summary mode, which names the row and the artifact', () => {
    expect(inputOf(() => resolve({ comment: 'summary' }))).toBe('platform');
    expect(resolve({ comment: 'summary', platform: 'linux/amd64' }).comment).toBe('summary');
  });

  it('hands the ignore file to the workspace check, and keeps the path as written', () => {
    const seen: string[] = [];
    const options = resolve({ trivyIgnoreFile: ' .trivyignore ' }, (value) => {
      seen.push(value);
      return `/workspace/${value}`;
    });

    expect(seen).toEqual(['.trivyignore']);
    expect(options.ignoreFile).toBe('.trivyignore');
  });

  it('propagates a refusal from the workspace check', () => {
    expect(() =>
      resolve({ trivyIgnoreFile: '../outside' }, () => {
        throw new Error('escapes');
      }),
    ).toThrow('escapes');
  });
});

describe('parseMebibytes', () => {
  it.each([
    ['0', 0],
    ['150', 150],
    [' 150 ', 150],
    ['150.5', 150.5],
  ])('reads %j as %d', (value, expected) => {
    expect(parseMebibytes('size-warning-mib', value)).toBe(expected);
  });

  it.each(['', '1e3', '0x10', '.5', '1.2345', '12345678'])('rejects %j', (value) => {
    expect(() => parseMebibytes('size-warning-mib', value)).toThrow(InvalidInputError);
  });
});

describe('parseSeverity', () => {
  it('upper-cases, deduplicates and orders most severe first', () => {
    expect(parseSeverity('high, critical,HIGH')).toBe('CRITICAL,HIGH');
    expect(parseSeverity('LOW,UNKNOWN,MEDIUM')).toBe('MEDIUM,LOW,UNKNOWN');
  });

  it('rejects an empty list', () => {
    expect(() => parseSeverity(' , ')).toThrow('must name at least one');
  });
});

describe('parseBoolean', () => {
  it.each(['true', 'True', 'TRUE'])('accepts %j as true', (value) => {
    expect(parseBoolean('x', value)).toBe(true);
  });

  it.each(['false', 'False', 'FALSE'])('accepts %j as false', (value) => {
    expect(parseBoolean('x', value)).toBe(false);
  });
});
