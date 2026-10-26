import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';

import { MAX_METADATA_BYTES, METADATA_FILE_NAME, parseMetadata, PATCH_FILE_NAME, sha256Hex } from 'actions-util/patch';

import type { PatchMetadata } from 'actions-util/patch';
import type { FileHandle } from 'node:fs/promises';

/** Raised when the downloaded artifact is not exactly what `create-patch` uploads. */
export class ArtifactContentError extends Error {
  constructor(message: string) {
    super(`The patch artifact is invalid: ${message}`);
    this.name = 'ArtifactContentError';
  }
}

/** A validated artifact: its metadata, and where the patch bytes it describes are on disk. */
export interface PatchArtifact {
  metadata: PatchMetadata;
  /** Absolute path of the patch file, whose size and digest match the metadata. */
  patchPath: string;
}

/** The only entries an artifact may hold. */
const EXPECTED_ENTRIES = [METADATA_FILE_NAME, PATCH_FILE_NAME].sort();

/**
 * Reads a regular file of at most `limit` bytes, refusing anything else at that path.
 *
 * Opened with `O_NOFOLLOW` and checked through the open handle: a symbolic link in the artifact would
 * otherwise make this read a file of the attacker's choosing elsewhere on the runner, and checking the
 * handle rather than the path leaves no window for the entry to be swapped between check and read.
 *
 * Exported for its tests only: an open failure other than `ELOOP` cannot be provoked through
 * {@link readPatchArtifact}, which lists the directory first.
 */
export async function readRegularFile(filePath: string, limit: number, limitName: string): Promise<Buffer> {
  const name = path.basename(filePath);
  let handle: FileHandle;

  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new ArtifactContentError(`${name} is a symbolic link.`);
    }
    throw error;
  }

  try {
    const stats = await handle.stat();

    if (!stats.isFile()) {
      throw new ArtifactContentError(`${name} is not a regular file.`);
    }
    if (stats.size > limit) {
      throw new ArtifactContentError(`${name} is ${stats.size} bytes, above ${limitName} (${limit}).`);
    }

    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * Validates the directory download-artifact extracted the artifact into, and returns its contents.
 *
 * The directory must hold exactly the metadata and the patch, both regular files. The metadata is
 * parsed strictly, and the patch must have the size and SHA-256 it records. The digest is not a
 * signature — both files come from the same untrusted job — but it does turn a truncated or mixed-up
 * upload into an error instead of a partial commit.
 *
 * @param maxPatchBytes ceiling on the patch, checked before it is read.
 * @throws {ArtifactContentError} for any deviation.
 */
export async function readPatchArtifact(directory: string, maxPatchBytes: number): Promise<PatchArtifact> {
  let entries: string[];

  try {
    entries = (await readdir(directory)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ArtifactContentError(`nothing was downloaded to ${directory}.`);
    }
    throw error;
  }

  if (entries.length !== EXPECTED_ENTRIES.length || entries.some((entry, index) => entry !== EXPECTED_ENTRIES[index])) {
    throw new ArtifactContentError(
      `expected exactly ${EXPECTED_ENTRIES.join(' and ')}; found ${entries.join(', ') || 'nothing'}.`,
    );
  }

  const metadataBytes = await readRegularFile(
    path.join(directory, METADATA_FILE_NAME),
    MAX_METADATA_BYTES,
    'the metadata limit',
  );
  const metadata = parseMetadata(metadataBytes.toString('utf8'));

  const patchPath = path.join(directory, PATCH_FILE_NAME);
  const patch = await readRegularFile(patchPath, maxPatchBytes, 'max_patch_bytes');

  if (patch.length !== metadata.patchBytes) {
    throw new ArtifactContentError(
      `the patch is ${patch.length} bytes but the metadata records ${metadata.patchBytes}.`,
    );
  }
  if (sha256Hex(patch) !== metadata.patchSha256) {
    throw new ArtifactContentError('the patch does not match the SHA-256 recorded in the metadata.');
  }

  return { metadata, patchPath };
}
