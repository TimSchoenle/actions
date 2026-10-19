import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assertListed, parseChecksums, sha256File } from './checksums.js';
import { VerificationError } from './errors.js';

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
