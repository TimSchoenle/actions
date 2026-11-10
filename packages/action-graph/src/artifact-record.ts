/**
 * Checks on the artifact record the GitHub REST API returns for an artifact id, made before the
 * artifact is downloaded.
 *
 * download-artifact verifies the archive against the digest the artifact service recorded, but it
 * reports no digest itself. Comparing that recorded digest with the one the uploading job published
 * pins the download to exactly the archive that job uploaded.
 *
 * @packageDocumentation
 */
import { isSha256Hex } from './hash.js';

/** The fields of `GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}` read here. */
export interface ArtifactRecord {
  readonly id: number;
  readonly expired: boolean;
  /** `sha256:<hex>`; absent on artifacts uploaded before digests were recorded. */
  readonly digest?: string | null;
  readonly workflow_run?: { readonly id?: number | null } | null;
}

/** What the record must match. */
export interface ArtifactExpectation {
  readonly id: number;
  /** The digest the uploading job published, with or without a `sha256:` prefix. */
  readonly digest: string;
  /** The workflow run that must own the artifact. */
  readonly runId: number;
}

/**
 * The lowercase hexadecimal digest in `value`, which may carry a `sha256:` prefix as the REST API
 * writes it.
 *
 * @throws an `Error` when what remains is not a SHA-256 digest
 */
export function normalizeArtifactDigest(value: string): string {
  const trimmed = value.trim();
  const hex = trimmed.startsWith('sha256:') ? trimmed.slice('sha256:'.length) : trimmed;
  if (!isSha256Hex(hex)) {
    throw new Error(
      `Expected a SHA-256 artifact digest, optionally prefixed with sha256:; got ${JSON.stringify(value)}.`,
    );
  }

  return hex;
}

/**
 * Checks an artifact record against what the uploading job published.
 *
 * @throws an `Error` naming the first mismatch: another id, an expired artifact, another workflow
 * run, a missing digest or a different one
 */
export function checkArtifactRecord(record: ArtifactRecord, expected: ArtifactExpectation): void {
  if (record.id !== expected.id) {
    throw new Error(`The API returned artifact ${record.id} for artifact ${expected.id}.`);
  }
  if (record.expired) {
    throw new Error(`Artifact ${expected.id} has expired.`);
  }
  const runId = record.workflow_run?.id;
  if (runId !== expected.runId) {
    throw new Error(`Artifact ${expected.id} belongs to workflow run ${String(runId)}, expected ${expected.runId}.`);
  }
  if (typeof record.digest !== 'string' || record.digest === '') {
    throw new Error(`Artifact ${expected.id} has no recorded digest to verify.`);
  }
  const actual = normalizeArtifactDigest(record.digest);
  const wanted = normalizeArtifactDigest(expected.digest);
  if (actual !== wanted) {
    throw new Error(`Artifact ${expected.id} has digest ${actual}, expected ${wanted}.`);
  }
}
