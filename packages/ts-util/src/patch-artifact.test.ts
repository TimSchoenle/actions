import { fc, it as prop } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import {
  describePatch,
  isCommitSha,
  parseByteLimit,
  parseMetadata,
  PATCH_ARTIFACT_VERSION,
  PatchArtifactError,
  serializeMetadata,
  sha256Hex,
  validateArtifactName,
} from './patch-artifact.js';

const SHA = 'a'.repeat(40);
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** The on-disk form of a valid document, as a mutable object a case can corrupt. */
function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    base_sha: SHA,
    has_changes: true,
    patch_bytes: 3,
    patch_sha256: sha256Hex(Buffer.from('abc')),
    version: PATCH_ARTIFACT_VERSION,
    ...overrides,
  };
}

describe('isCommitSha', () => {
  it.each([SHA, 'f'.repeat(64)])('accepts the full form %s', (sha) => {
    expect(isCommitSha(sha)).toBe(true);
  });

  it.each(['', 'abc123', 'A'.repeat(40), `${SHA}\n`, 'g'.repeat(40), 'a'.repeat(41)])('refuses %j', (sha) => {
    expect(isCommitSha(sha)).toBe(false);
  });
});

describe('validateArtifactName', () => {
  it.each(['patch', 'update-files-builds', 'a', 'A.b_c-1', 'x'.repeat(100)])('accepts %j', (name) => {
    expect(validateArtifactName(name)).toBe(name);
  });

  it.each(['', '-leading', '.hidden', '../escape', 'a/b', 'a\\b', 'space name', 'x'.repeat(101), 'tab\t', 'née'])(
    'refuses %j',
    (name) => {
      expect(() => validateArtifactName(name)).toThrow(PatchArtifactError);
    },
  );
});

describe('parseByteLimit', () => {
  it.each([
    ['1', 1],
    ['10485760', 10_485_760],
    [' 42 ', 42],
  ])('parses %j', (value, expected) => {
    expect(parseByteLimit(value, 'max_patch_bytes')).toBe(expected);
  });

  it.each(['', '0', '-1', '1.5', '1e6', '0x10', 'ten', '99999999999999999'])(
    'refuses %j, naming the input',
    (value) => {
      expect(() => parseByteLimit(value, 'max_patch_bytes')).toThrow(/^max_patch_bytes must be/);
    },
  );
});

describe('describePatch', () => {
  it('records an empty patch as having no changes', () => {
    expect(describePatch(SHA, Buffer.alloc(0))).toEqual({
      baseSha: SHA,
      hasChanges: false,
      patchBytes: 0,
      patchSha256: EMPTY_SHA256,
      version: PATCH_ARTIFACT_VERSION,
    });
  });

  it('records size and digest of a non-empty patch', () => {
    const metadata = describePatch(SHA, Buffer.from('abc'));

    expect(metadata.hasChanges).toBe(true);
    expect(metadata.patchBytes).toBe(3);
    expect(metadata.patchSha256).toBe(sha256Hex(Buffer.from('abc')));
  });
});

describe('parseMetadata', () => {
  it('reads back what serializeMetadata wrote', () => {
    const metadata = describePatch(SHA, Buffer.from('abc'));

    expect(parseMetadata(serializeMetadata(metadata))).toEqual(metadata);
  });

  it('writes snake_case keys and a trailing newline', () => {
    const text = serializeMetadata(describePatch(SHA, Buffer.alloc(0)));

    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual([
      'version',
      'base_sha',
      'has_changes',
      'patch_bytes',
      'patch_sha256',
    ]);
  });

  it.each([
    ['not JSON', '{', /not valid JSON/],
    ['an array', '[]', /must hold a JSON object/],
    ['null', 'null', /must hold a JSON object/],
  ])('refuses %s', (_name, text, message) => {
    expect(() => parseMetadata(text)).toThrow(message);
  });

  it.each([
    ['an unknown version', { version: 2 }, /version 2/],
    ['a string version', { version: '1' }, /version "1"/],
    ['an abbreviated base', { base_sha: 'abc1234' }, /base_sha/],
    ['an uppercase base', { base_sha: 'A'.repeat(40) }, /base_sha/],
    ['a non-boolean has_changes', { has_changes: 'true' }, /has_changes must be a boolean/],
    ['a negative size', { patch_bytes: -1 }, /patch_bytes/],
    ['a fractional size', { patch_bytes: 1.5 }, /patch_bytes/],
    ['a malformed digest', { patch_sha256: 'xyz' }, /patch_sha256/],
    ['has_changes contradicting the size', { has_changes: false }, /contradicts/],
    ['an empty patch claiming changes', { has_changes: true, patch_bytes: 0 }, /contradicts/],
  ])('refuses %s', (_name, overrides, message) => {
    expect(() => parseMetadata(JSON.stringify(document(overrides)))).toThrow(message);
  });

  it('refuses an extra key rather than ignoring it', () => {
    expect(() => parseMetadata(JSON.stringify(document({ paths: ['x'] })))).toThrow(/exactly the keys/);
  });

  it('refuses a missing key', () => {
    const { patch_sha256: _dropped, ...rest } = document();

    expect(() => parseMetadata(JSON.stringify(rest))).toThrow(/exactly the keys/);
  });

  prop.prop([fc.uint8Array({ maxLength: 512 }), fc.stringMatching(/^[0-9a-f]{40}$/)])(
    'round-trips the metadata of any patch',
    (patch, sha) => {
      const metadata = describePatch(sha, patch);

      expect(parseMetadata(serializeMetadata(metadata))).toEqual(metadata);
    },
  );
});
