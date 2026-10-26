/**
 * The artifact `common/create-patch` uploads and `common/commit-patch` downloads, as one contract.
 *
 * The two actions run in different jobs of one workflow run: the first beside the repository's own
 * build, holding no credential, and the second beside a write token, never running repository code.
 * Everything that crosses between them is in this artifact, so the second job treats every byte of it
 * as untrusted, and this module is where both sides agree on what a well-formed one looks like.
 */
import { createHash } from 'node:crypto';

/** Name of the patch file inside the artifact. */
export const PATCH_FILE_NAME = 'changes.patch';

/** Name of the metadata file inside the artifact. */
export const METADATA_FILE_NAME = 'metadata.json';

/** Version of the metadata layout. A reader refuses any other, rather than guessing at it. */
export const PATCH_ARTIFACT_VERSION = 1;

/**
 * Ceiling on the metadata file. It holds four short fields; anything larger is not one of ours, and
 * refusing it before parsing keeps an oversized file from being read into memory at all.
 */
export const MAX_METADATA_BYTES = 4096;

/** Default ceiling on the patch, shared by both actions so their defaults cannot drift apart. */
export const DEFAULT_MAX_PATCH_BYTES = 10 * 1024 * 1024;

/** What `metadata.json` records about the patch beside it. */
export interface PatchMetadata {
  /** Layout version, always {@link PATCH_ARTIFACT_VERSION}. */
  version: number;
  /** The commit the patch was computed against: `HEAD` of the checkout it was taken from. */
  baseSha: string;
  /** Whether the patch is non-empty. */
  hasChanges: boolean;
  /** Size of the patch file in bytes. */
  patchBytes: number;
  /** Lowercase hex SHA-256 of the patch file. */
  patchSha256: string;
}

/** Raised when an artifact name or the metadata does not have the shape this contract defines. */
export class PatchArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchArtifactError';
  }
}

/** A full commit SHA: 40 hex digits for SHA-1 repositories, 64 for SHA-256 ones. */
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A lowercase hex SHA-256 digest. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Characters an artifact name may use.
 *
 * Narrower than upload-artifact allows, on purpose: the name also becomes a directory under
 * `RUNNER_TEMP`, so a separator, `..` or a character a filesystem rejects must never reach it.
 */
const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** True when `value` is a full, lowercase commit SHA. */
export function isCommitSha(value: string): boolean {
  return COMMIT_SHA.test(value);
}

/**
 * Returns the artifact name unchanged when it is safe to use as both an artifact and a directory name.
 *
 * @throws {PatchArtifactError} for an empty name, a name over 100 characters, or one using anything
 * other than letters, digits, `.`, `_` and `-`, or starting with something other than a letter or digit.
 */
export function validateArtifactName(name: string): string {
  if (!ARTIFACT_NAME.test(name)) {
    throw new PatchArtifactError(
      `artifact_name must be 1 to 100 characters of letters, digits, '.', '_' and '-', starting with a ` +
        `letter or digit; got ${JSON.stringify(name)}.`,
    );
  }

  return name;
}

/**
 * Parses a size limit input as a positive whole number of bytes.
 *
 * @throws {PatchArtifactError} for anything that is not a plain positive integer.
 */
export function parseByteLimit(value: string, inputName: string): number {
  const trimmed = value.trim();

  if (!/^[1-9]\d{0,15}$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
    throw new PatchArtifactError(
      `${inputName} must be a positive whole number of bytes; got ${JSON.stringify(value)}.`,
    );
  }

  return Number(trimmed);
}

/** Lowercase hex SHA-256 of `bytes`. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Builds the metadata for `patch`, computed against `baseSha`. */
export function describePatch(baseSha: string, patch: Uint8Array): PatchMetadata {
  return {
    baseSha,
    hasChanges: patch.length > 0,
    patchBytes: patch.length,
    patchSha256: sha256Hex(patch),
    version: PATCH_ARTIFACT_VERSION,
  };
}

/** Renders the metadata in its on-disk form, with snake_case keys and a trailing newline. */
export function serializeMetadata(metadata: PatchMetadata): string {
  return `${JSON.stringify(
    {
      version: metadata.version,
      base_sha: metadata.baseSha,
      has_changes: metadata.hasChanges,
      patch_bytes: metadata.patchBytes,
      patch_sha256: metadata.patchSha256,
    },
    null,
    2,
  )}\n`;
}

/** The exact key set of the on-disk form. Any other key is refused rather than ignored. */
const METADATA_KEYS = ['base_sha', 'has_changes', 'patch_bytes', 'patch_sha256', 'version'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses and validates `metadata.json` as written by {@link serializeMetadata}.
 *
 * Strict in every direction, because the file comes from a job that ran untrusted code: an unknown
 * version, a missing or extra key, a field of the wrong type and a SHA in any form but full lowercase
 * hex are all refused. The checks that relate the metadata to the patch bytes are the reader's.
 *
 * @throws {PatchArtifactError} when the text is not a well-formed metadata document.
 */
export function parseMetadata(text: string): PatchMetadata {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new PatchArtifactError(`${METADATA_FILE_NAME} is not valid JSON: ${(error as Error).message}`);
  }

  if (!isPlainObject(raw)) {
    throw new PatchArtifactError(`${METADATA_FILE_NAME} must hold a JSON object.`);
  }

  const keys = Object.keys(raw).sort();
  if (keys.length !== METADATA_KEYS.length || keys.some((key, index) => key !== METADATA_KEYS[index])) {
    throw new PatchArtifactError(
      `${METADATA_FILE_NAME} must have exactly the keys ${METADATA_KEYS.join(', ')}; got ${keys.join(', ') || 'none'}.`,
    );
  }

  const { base_sha: baseSha, has_changes: hasChanges, patch_bytes: patchBytes, patch_sha256: patchSha256 } = raw;

  if (raw.version !== PATCH_ARTIFACT_VERSION) {
    throw new PatchArtifactError(
      `${METADATA_FILE_NAME} has version ${JSON.stringify(raw.version)}; only ${PATCH_ARTIFACT_VERSION} is understood.`,
    );
  }
  if (typeof baseSha !== 'string' || !isCommitSha(baseSha)) {
    throw new PatchArtifactError(`${METADATA_FILE_NAME} base_sha must be a full lowercase commit SHA.`);
  }
  if (typeof hasChanges !== 'boolean') {
    throw new PatchArtifactError(`${METADATA_FILE_NAME} has_changes must be a boolean.`);
  }
  if (typeof patchBytes !== 'number' || !Number.isSafeInteger(patchBytes) || patchBytes < 0) {
    throw new PatchArtifactError(`${METADATA_FILE_NAME} patch_bytes must be a non-negative whole number.`);
  }
  if (typeof patchSha256 !== 'string' || !SHA256_HEX.test(patchSha256)) {
    throw new PatchArtifactError(`${METADATA_FILE_NAME} patch_sha256 must be a lowercase hex SHA-256 digest.`);
  }
  if (hasChanges !== patchBytes > 0) {
    throw new PatchArtifactError(`${METADATA_FILE_NAME} has_changes contradicts patch_bytes.`);
  }

  return { baseSha, hasChanges, patchBytes, patchSha256, version: PATCH_ARTIFACT_VERSION };
}
