/**
 * SHA-256 verification of downloaded files: against a pinned digest, and against a `sha256sum`-format
 * checksum list that is itself pinned.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

/** A downloaded file is not the one its publisher listed, or not the one the caller pinned. */
export class VerificationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'VerificationError';
  }
}

/** `<64 hex digits><space><space or *><file name>`, the format `sha256sum` writes. */
const LINE = /^([\da-f]{64}) [ *](.+)$/i;

/** A SHA-256 written as 64 hex digits. */
const DIGEST = /^[\da-f]{64}$/i;

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

/** Whether `value` is a SHA-256 written as 64 hex digits, in either case. */
export function isSha256(value: string): boolean {
  return DIGEST.test(value);
}

/** The file reads verification needs, injected so it can be tested without a file system. */
export interface ChecksumFiles {
  readText(file: string): Promise<string>;
  sha256(file: string): Promise<string>;
}

/** The real file system. */
export const checksumFiles: ChecksumFiles = {
  readText: (file) => readFile(file, 'utf8'),
  sha256: sha256File,
};

/** Throws unless the file `name` downloaded to `file` has the SHA-256 `expected`. */
export async function verifySha256(files: ChecksumFiles, file: string, name: string, expected: string): Promise<void> {
  if (!isSha256(expected)) {
    throw new VerificationError(`The SHA-256 pinned for ${name} is not 64 hex digits: ${JSON.stringify(expected)}.`);
  }

  const actual = await files.sha256(file);

  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new VerificationError(`${name}: SHA-256 is ${actual}, but ${expected.toLowerCase()} was pinned.`);
  }
}

/** A downloaded file and the name it is published under. */
export interface DownloadedFile {
  /** Where the file was downloaded to. */
  readonly file: string;
  /** Its name in the release, which is how a checksum list refers to it. */
  readonly name: string;
}

/**
 * Throws unless the checksum list matches its pinned SHA-256 and then lists `asset` with its digest.
 *
 * The list is checked first: a list nobody pinned proves nothing about the files it names. One pin
 * on the list covers every asset it lists, so a caller pins one digest for all platforms.
 */
export async function verifyWithChecksums(
  files: ChecksumFiles,
  checksums: DownloadedFile,
  checksumsSha256: string,
  asset: DownloadedFile,
): Promise<void> {
  await verifySha256(files, checksums.file, checksums.name, checksumsSha256);

  const digests = parseChecksums(await files.readText(checksums.file), checksums.name);

  assertListed(digests, checksums.name, asset.name, await files.sha256(asset.file));
}
