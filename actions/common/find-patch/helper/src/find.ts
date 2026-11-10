import * as core from 'actions-util/core';
import { readPatchArtifact } from 'actions-util/patch-reader';

import type { RepositoryCoordinates } from 'actions-util';

/** What the artifact listing reports about one artifact. */
export interface ArtifactSummary {
  id: number;
  name: string;
  /** True once the artifact is past its retention and can no longer be downloaded. */
  expired: boolean;
  /** The size of the archive GitHub stores, before download-artifact extracts it. */
  sizeInBytes: number;
}

/** The one GitHub call `lookup` makes, as a seam the tests can replace. */
export interface ArtifactApi {
  /**
   * Lists the artifacts of `runId` that GitHub reports under `name`.
   *
   * @throws {RunNotFoundError} when the run does not exist or the token may not see it.
   */
  listArtifacts(repository: RepositoryCoordinates, runId: number, name: string): Promise<ArtifactSummary[]>;
}

/** Raised when the run named by `run_id` cannot be listed at all. */
export class RunNotFoundError extends Error {
  constructor(repository: RepositoryCoordinates, runId: number, options?: ErrorOptions) {
    super(
      `Workflow run ${runId} of ${repository.owner}/${repository.repo} was not found. Check run_id, and that the ` +
        'token has actions: read.',
      options,
    );
    this.name = 'RunNotFoundError';
  }
}

/**
 * The run's artifacts of exactly that name that can still be downloaded, newest (highest ID) first.
 *
 * An expired artifact counts as missing: the listing keeps it after its retention, but download-artifact
 * can no longer fetch it, and a run that old has nothing left to commit. The name is compared exactly
 * as well, rather than trusting the API's filter, which is the only thing that would otherwise stand
 * between a near-miss name and a download of the wrong patch.
 *
 * More than one can be live when a re-run attempt uploaded the name again. download-artifact then
 * fetches the newest by ID, so that is the one the caller should expect to inspect.
 */
export async function findArtifacts(
  api: ArtifactApi,
  repository: RepositoryCoordinates,
  runId: number,
  name: string,
): Promise<ArtifactSummary[]> {
  return (await api.listArtifacts(repository, runId, name))
    .filter((artifact) => artifact.name === name && !artifact.expired)
    .toSorted((left, right) => right.id - left.id);
}

/**
 * The waits between listings of this run's own artifacts, in milliseconds: 10 s in total over at most
 * five listings, and none at all when the first listing already holds the artifact.
 *
 * GitHub's artifact listing is eventually consistent with upload finalization: an artifact a job of this
 * run finalized a second ago can still be absent from the listing. Only this run can have an upload that
 * recent, so only a lookup in this run waits. The bound keeps the API calls few, since the token may be an
 * App installation's with a tight hourly budget.
 */
export const CURRENT_RUN_LISTING_DELAYS_MS: readonly number[] = [1000, 2000, 3000, 4000];

/** Waits `milliseconds`; replaced in tests so they need no real timers. */
export type Sleep = (milliseconds: number) => Promise<void>;

/** Waits on a real timer. */
export const realSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * {@link findArtifacts}, repeated after each of `delaysMs` while it finds nothing.
 *
 * An empty result is taken at face value once the delays are spent, so a run whose producing job did not
 * run still settles as missing. Errors are never retried here: a missing run or a refused request fails
 * the lookup on the first attempt.
 *
 * @param delaysMs the waits before each repeated listing; empty lists exactly once.
 */
export async function findArtifactsWithin(
  api: ArtifactApi,
  repository: RepositoryCoordinates,
  runId: number,
  name: string,
  delaysMs: readonly number[],
  sleep: Sleep = realSleep,
): Promise<ArtifactSummary[]> {
  let artifacts = await findArtifacts(api, repository, runId, name);

  for (const [index, delayMs] of delaysMs.entries()) {
    if (artifacts.length > 0) {
      break;
    }
    core.info(
      `Workflow run ${runId} lists no unexpired artifact named ${name} yet; GitHub can list an upload a few ` +
        `seconds after it finished. Listing again in ${delayMs}ms (retry ${index + 1} of ${delaysMs.length}).`,
    );
    await sleep(delayMs);
    artifacts = await findArtifacts(api, repository, runId, name);
  }

  return artifacts;
}

/**
 * Room beside the patch for `metadata.json` and the archive's own headers. Both are a few hundred bytes;
 * the margin only has to be far below anything that could hurt a runner.
 */
export const ARCHIVE_OVERHEAD_BYTES = 1024 * 1024;

/**
 * Refuses an archive larger than any create-patch artifact within `maxPatchBytes` can be, before it is
 * downloaded.
 *
 * download-artifact extracts whatever the archive holds, and the reader only checks it afterwards. A
 * create-patch artifact is one patch of at most `maxPatchBytes` and a small metadata file, so its
 * archive can never exceed that plus {@link ARCHIVE_OVERHEAD_BYTES}. Anything bigger did not come from
 * create-patch, and is refused without spending the job's time and disk on it.
 *
 * @throws {Error} when the archive is larger than that bound.
 */
export function assertArchiveSize(artifact: ArtifactSummary, maxPatchBytes: number): void {
  const limit = maxPatchBytes + ARCHIVE_OVERHEAD_BYTES;
  if (artifact.sizeInBytes > limit) {
    throw new Error(
      `Artifact ${artifact.id} (${artifact.name}) is ${artifact.sizeInBytes} bytes, more than any create-patch ` +
        `artifact within max_patch_bytes (${maxPatchBytes}) can be (${limit}); it was not downloaded.`,
    );
  }
}

/** What the downloaded patch amounts to, for a job deciding whether to commit it. */
export type PatchOutcome = 'branch_moved' | 'changes' | 'no_changes';

export interface PatchInspection {
  outcome: PatchOutcome;
  /** The commit the patch was made from, as its metadata records it. */
  baseSha: string;
}

/**
 * Validates the downloaded artifact exactly as commit-patch will, and classifies it.
 *
 * The checks run in commit-patch's order, so the outcome is the one commit-patch would end with: a
 * patch made from a commit other than `expectedHeadSha` is `branch_moved`, empty or not, and otherwise
 * an empty patch is `no_changes`. Only `changes` leaves anything to commit.
 *
 * @param expectedHeadSha the commit the patch must have been made from; empty accepts any.
 * @throws {ArtifactContentError} or {PatchArtifactError} when the artifact is not one create-patch
 * wrote. That is never read as "nothing to commit": it fails the step.
 */
export async function inspectArtifact(
  directory: string,
  maxPatchBytes: number,
  expectedHeadSha: string,
): Promise<PatchInspection> {
  const { metadata } = await readPatchArtifact(directory, maxPatchBytes);

  if (expectedHeadSha !== '' && metadata.baseSha !== expectedHeadSha) {
    return { baseSha: metadata.baseSha, outcome: 'branch_moved' };
  }
  if (!metadata.hasChanges) {
    return { baseSha: metadata.baseSha, outcome: 'no_changes' };
  }

  return { baseSha: metadata.baseSha, outcome: 'changes' };
}
