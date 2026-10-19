/**
 * `sha256sum`-format checksum lists, and checking a downloaded file against one.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { VerificationError } from './errors.js';

/** `<64 hex digits><space><space or *><file name>`, the format `sha256sum` writes. */
const LINE = /^([\da-f]{64}) [ *](.+)$/i;

/**
 * The digest each file name maps to.
 *
 * A name listed twice is refused rather than resolved either way: a list that disagrees with itself
 * proves nothing about the file.
 */
export function parseChecksums(text: string, list: string): ReadonlyMap<string, string> {
  const digests = new Map<string, string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();

    if (line === '') {
      continue;
    }

    const match = LINE.exec(line);

    if (match === null) {
      throw new VerificationError(`${list}: not a sha256sum line: ${JSON.stringify(line)}`);
    }

    const [, digest = '', name = ''] = match;

    if (digests.has(name)) {
      throw new VerificationError(`${list}: lists ${name} more than once.`);
    }

    digests.set(name, digest.toLowerCase());
  }

  return digests;
}

/** The SHA-256 of a file, as lowercase hex. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }

  return hash.digest('hex');
}

/** Throws unless `actual` is the digest `list` records for `name`. */
export function assertListed(digests: ReadonlyMap<string, string>, list: string, name: string, actual: string): void {
  const expected = digests.get(name);

  if (expected === undefined) {
    throw new VerificationError(`${list} does not list ${name}, so it cannot be verified.`);
  }

  if (expected !== actual.toLowerCase()) {
    throw new VerificationError(`${name}: SHA-256 is ${actual}, but ${list} records ${expected}.`);
  }
}
