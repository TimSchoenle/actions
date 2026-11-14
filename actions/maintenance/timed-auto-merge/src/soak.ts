import { createHash } from 'node:crypto';

/** What `time_elapsed` is measured from. */
export type SoakFrom = 'content' | 'opened';

const SOAK_FROM_VALUES: readonly SoakFrom[] = ['opened', 'content'];

/**
 * Validates `soak_from`.
 *
 * @throws if the value is not `opened` or `content`.
 */
export function parseSoakFrom(value: string): SoakFrom {
  if (!(SOAK_FROM_VALUES as readonly string[]).includes(value)) {
    throw new Error(`Invalid 'soak_from' ${JSON.stringify(value)}. Expected one of: ${SOAK_FROM_VALUES.join(', ')}.`);
  }

  return value as SoakFrom;
}

/** One changed file of a comparison, reduced to what the fingerprint reads. */
export interface DiffFile {
  filename: string;
  /** The old path of a renamed file, otherwise `null`. */
  previousFilename: string | null;
  /** GitHub's file status, such as `added`, `modified`, `removed` or `renamed`. */
  status: string;
  /** The unified diff of the file, or `null` when GitHub sends none (binary or too large). */
  patch: string | null;
  /** The blob SHA GitHub reports for the file, used in place of a missing patch; `null` when it sends none. */
  sha: string | null;
}

/**
 * Why a diff cannot be fingerprinted, or `undefined` when it can.
 *
 * A file with neither a patch nor a blob SHA, or a list GitHub cut short, leaves part of the change
 * unseen, so a change there would not restart the wait.
 */
export function unreadableDiffReason(files: readonly DiffFile[], truncated: boolean): string | undefined {
  if (truncated) {
    return `GitHub lists at most ${files.length} changed files and may have left some out`;
  }

  const blind = files.find((file) => file.patch === null && file.sha === null);

  return blind ? `GitHub sent neither a patch nor a blob SHA for ${JSON.stringify(blind.filename)}` : undefined;
}

/**
 * Keeps only the added and removed lines of a unified diff.
 *
 * Hunk headers carry line numbers, and context lines are whatever surrounds the change on the base
 * branch, so both change when the pull request is rebased onto a base that moved, even though the
 * change itself did not. Dropping them is what lets a rebase keep the fingerprint. The cost is that
 * the same lines moved to another place in the same file keep it as well; every commit is still
 * verified, so this only decides how long to wait, never whether a commit is trusted.
 */
function changedLines(patch: string): string[] {
  return patch.split('\n').filter((line) => line.startsWith('+') || line.startsWith('-'));
}

/**
 * Hashes what a pull request changes, independent of the commits it is made of and of the base it
 * is currently on.
 *
 * Files are sorted by path so the order GitHub lists them in does not matter. A file without a patch
 * is identified by its blob SHA, which changes whenever its content does.
 *
 * @returns a lower-case SHA-256 hex digest.
 */
export function fingerprintDiff(files: readonly DiffFile[]): string {
  const entries = files
    .map((file) => ({
      change: file.patch === null ? { blob: file.sha } : { lines: changedLines(file.patch) },
      filename: file.filename,
      previousFilename: file.previousFilename,
      status: file.status,
    }))
    .sort((left, right) => (left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0));

  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

/** The state this action keeps on a pull request in `content` mode. */
export interface SoakMarker {
  /** {@link fingerprintDiff} of the change the wait is measured for. */
  fingerprint: string;
  /** When this action first saw that change, in epoch milliseconds. */
  sinceMs: number;
}

const MARKER_PATTERN = /<!-- timed-auto-merge:soak v1 fingerprint=([0-9a-f]{64}) since=(\S+) -->/;

/**
 * Reads the marker from a comment body.
 *
 * @returns the marker, or `undefined` when the body has none or its time cannot be read.
 */
export function parseSoakMarker(body: string): SoakMarker | undefined {
  const match = MARKER_PATTERN.exec(body);

  if (!match) {
    return undefined;
  }

  const sinceMs = Date.parse(match[2]);

  return Number.isNaN(sinceMs) ? undefined : { fingerprint: match[1], sinceMs };
}

/** Whether a comment body carries a marker, readable or not, so a broken one is rewritten in place. */
export function hasSoakMarker(body: string): boolean {
  return body.includes('<!-- timed-auto-merge:soak ');
}

/** Renders the comment that carries the marker, with a line a person reading the pull request understands. */
export function renderSoakComment(marker: SoakMarker, waitText: string): string {
  const since = new Date(marker.sinceMs).toISOString();

  return [
    `<!-- timed-auto-merge:soak v1 fingerprint=${marker.fingerprint} since=${since} -->`,
    `**Timed auto-merge:** the changes in this pull request were last seen changing at ${since}. It becomes eligible`,
    `once they have stayed the same for ${waitText}. A rebase or update from the base branch that leaves the`,
    'changes as they are does not restart the wait.',
  ].join('\n');
}
