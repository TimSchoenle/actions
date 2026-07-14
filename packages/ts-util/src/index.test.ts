import { describe, expect, it } from 'vitest';
import {
  parseRepository,
  hasStatus,
  inferValueType,
  generateYamlString,
  formatValue,
  normalizeAppSlug,
  botUsername,
  botEmail,
} from './index.js';

describe('github utils', () => {
  it('parseRepository splits correctly', () => {
    expect(parseRepository('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('hasStatus detects status correctly', () => {
    expect(hasStatus({ status: 404 }, 404)).toBe(true);
    expect(hasStatus({ status: 500 }, 404)).toBe(false);
    expect(hasStatus(null, 404)).toBe(false);
  });
});

describe('yaml utils', () => {
  it('inferValueType works', () => {
    expect(inferValueType('123')).toBe(123);
    expect(inferValueType('true')).toBe(true);
    expect(inferValueType('null')).toBe(null);
    expect(inferValueType('string')).toBe('string');
  });

  it('generateYamlString works', () => {
    expect(generateYamlString('foo')).toBe('foo');
    expect(generateYamlString(123)).toBe('123');
  });

  // The serializer renders -0 as `0`. inferValueType preserves the sign, so dropping it here would
  // silently turn a written -0 into 0 — the one value where the two disagree.
  it('generateYamlString preserves negative zero', () => {
    expect(generateYamlString(inferValueType('-0') as number)).toBe('-0');
    expect(generateYamlString(0)).toBe('0');
  });

  it('formatValue works', () => {
    expect(formatValue(null)).toBe('null');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('identity utils', () => {
  it('normalizeAppSlug works', () => {
    expect(normalizeAppSlug('my-app[bot]')).toBe('my-app');
  });

  it('botUsername works', () => {
    expect(botUsername('my-app')).toBe('my-app[bot]');
  });

  it('botEmail works', () => {
    expect(botEmail(123, 'my-app[bot]')).toBe('123+my-app[bot]@users.noreply.github.com');
  });
});
