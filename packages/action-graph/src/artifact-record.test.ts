import { describe, expect, it } from 'vitest';

import { checkArtifactRecord, normalizeArtifactDigest } from './artifact-record.js';

const DIGEST = 'd'.repeat(64);
const RECORD = { id: 7, expired: false, digest: `sha256:${DIGEST}`, workflow_run: { id: 42 } };
const EXPECTED = { id: 7, digest: DIGEST, runId: 42 };

describe('normalizeArtifactDigest', () => {
  it('accepts the bare and the prefixed form', () => {
    expect(normalizeArtifactDigest(DIGEST)).toBe(DIGEST);
    expect(normalizeArtifactDigest(`sha256:${DIGEST}`)).toBe(DIGEST);
  });

  it.each(['', 'sha1:abc', `sha256:${'D'.repeat(64)}`, 'd'.repeat(63)])('rejects %j', (value) => {
    expect(() => normalizeArtifactDigest(value)).toThrow(/Expected a SHA-256 artifact digest/);
  });
});

describe('checkArtifactRecord', () => {
  it('accepts a matching record', () => {
    expect(() => checkArtifactRecord(RECORD, EXPECTED)).not.toThrow();
    expect(() => checkArtifactRecord(RECORD, { ...EXPECTED, digest: `sha256:${DIGEST}` })).not.toThrow();
  });

  it.each([
    [{ id: 8 }, /returned artifact 8/],
    [{ expired: true }, /has expired/],
    [{ workflow_run: { id: 41 } }, /belongs to workflow run 41, expected 42/],
    [{ workflow_run: null }, /belongs to workflow run undefined/],
    [{ digest: null }, /no recorded digest/],
    [{ digest: `sha256:${'e'.repeat(64)}` }, /has digest e{64}, expected d{64}/],
  ])('rejects a record with %j', (change, message) => {
    expect(() => checkArtifactRecord({ ...RECORD, ...change }, EXPECTED)).toThrow(message);
  });
});
