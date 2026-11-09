import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertListed,
  parseChecksums,
  sha256File,
  VerificationError,
  verifySha256,
  verifyWithChecksums,
} from './checksums.js';

import type { ChecksumFiles } from './checksums.js';

const A = 'a'.repeat(64);
const B = 'B'.repeat(64);

describe('parseChecksums', () => {
  it('reads text and binary mode lines, CRLF and blank lines', () => {
    const digests = parseChecksums(`${A}  one.tar.gz\r\n\n${B} *two.zip\n`, 'SUMS');

    expect([...digests]).toEqual([
      ['one.tar.gz', A],
      ['two.zip', 'b'.repeat(64)],
    ]);
  });

  it('refuses a line that is not sha256sum output', () => {
    expect(() => parseChecksums('abc  file\n', 'SUMS')).toThrow(VerificationError);
  });

  it('refuses a name listed twice', () => {
    expect(() => parseChecksums(`${A}  file\n${A}  file\n`, 'SUMS')).toThrow(/more than once/);
  });
});

describe('assertListed', () => {
  const digests = new Map([['file', A]]);

  it('accepts the recorded digest in any case', () => {
    expect(() => assertListed(digests, 'SUMS', 'file', A.toUpperCase())).not.toThrow();
  });

  it('refuses a different digest', () => {
    expect(() => assertListed(digests, 'SUMS', 'file', 'c'.repeat(64))).toThrow(/SUMS records/);
  });

  it('refuses a file the list does not name', () => {
    expect(() => assertListed(digests, 'SUMS', 'other', A)).toThrow(/does not list other/);
  });
});

describe('sha256File', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('hashes the file contents', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'terrace-setup-'));
    const file = path.join(directory, 'file');

    await writeFile(file, 'abc');

    expect(await sha256File(file)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

/** Files whose digest is looked up by path, all reading as `text`. */
function files(digests: Record<string, string>, text = ''): ChecksumFiles {
  return {
    readText: vi.fn(() => Promise.resolve(text)),
    sha256: vi.fn((file: string) => Promise.resolve(digests[file] ?? '')),
  };
}

describe('verifySha256', () => {
  it('accepts the pinned digest in any case', async () => {
    await expect(verifySha256(files({ f: A }), 'f', 'asset', A.toUpperCase())).resolves.toBeUndefined();
  });

  it('refuses another digest', async () => {
    await expect(verifySha256(files({ f: A }), 'f', 'asset', 'c'.repeat(64))).rejects.toThrow(/was pinned/);
  });

  it('refuses a pin that is not a SHA-256', async () => {
    await expect(verifySha256(files({ f: A }), 'f', 'asset', 'abc')).rejects.toThrow(/not 64 hex digits/);
  });
});

describe('verifyWithChecksums', () => {
  const sums = { file: '/d/SUMS', name: 'SUMS' };
  const asset = { file: '/d/tool.tar.gz', name: 'tool.tar.gz' };
  const C = 'c'.repeat(64);
  const LIST = `${A}  tool.tar.gz\n`;

  it('checks the list against its pin, then the asset against the list', async () => {
    const io = files({ '/d/SUMS': C, '/d/tool.tar.gz': A }, LIST);

    await expect(verifyWithChecksums(io, sums, C, asset)).resolves.toBeUndefined();
  });

  it('refuses a list that does not match its pin, before reading it', async () => {
    const io = files({ '/d/SUMS': A, '/d/tool.tar.gz': A }, LIST);

    await expect(verifyWithChecksums(io, sums, C, asset)).rejects.toThrow(VerificationError);
    expect(io.readText).not.toHaveBeenCalled();
  });

  it('refuses an asset that does not match the list', async () => {
    const io = files({ '/d/SUMS': C, '/d/tool.tar.gz': B.toLowerCase() }, LIST);

    await expect(verifyWithChecksums(io, sums, C, asset)).rejects.toThrow(/SUMS records/);
  });
});
