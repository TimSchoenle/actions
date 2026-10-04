/**
 * Reading the fragments `docker/image-check` legs upload, one JSON object per artifact.
 *
 * A fragment is the only input of this action that a different job wrote, so every field is checked
 * before it reaches Markdown. The image reference, platform and severity end up in code spans and
 * table cells unescaped, which is only safe because the grammars below admit no backtick, pipe,
 * angle bracket or line break.
 */

/** Schema version written by `docker/image-check`'s `render.ts`. */
export const FRAGMENT_VERSION = 1;

/** One leg's result, validated. */
export interface ImageFragment {
  readonly platform: string;
  readonly image: string;
  readonly sizeBytes: number;
  /** 0 when the leg had the warning disabled. */
  readonly warningMib: number;
  readonly findings: number;
  readonly severity: string;
}

/** A fragment that cannot be used, named by the artifact it came from. */
export class InvalidFragmentError extends Error {
  constructor(source: string, reason: string) {
    super(`Fragment ${source}: ${reason}`);
    this.name = 'InvalidFragmentError';
  }
}

/** Mirrors the platform grammar of `docker/image-check`'s `options.ts`. */
const PLATFORM = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;

/** Any printable reference without the characters that would break out of a code span or a cell. */
const IMAGE = /^[^\s`|<>\\\p{Cc}\p{Cf}]{1,512}$/u;

/** Trivy severities, comma-separated. */
const SEVERITY = /^(CRITICAL|HIGH|MEDIUM|LOW|UNKNOWN)(,(CRITICAL|HIGH|MEDIUM|LOW|UNKNOWN)){0,4}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function requireString(record: Record<string, unknown>, field: string, pattern: RegExp, source: string): string {
  const value = record[field];

  if (typeof value !== 'string') {
    throw new InvalidFragmentError(source, `'${field}' is missing or not a string.`);
  }

  if (!pattern.test(value)) {
    throw new InvalidFragmentError(source, `'${field}' is not a value docker/image-check writes.`);
  }

  return value;
}

function requireCount(record: Record<string, unknown>, field: string, source: string): number {
  const value = record[field];

  if (!isCount(value)) {
    throw new InvalidFragmentError(source, `'${field}' is missing or not a non-negative whole number.`);
  }

  return value;
}

/**
 * Validates one parsed fragment.
 *
 * @param source - names the fragment in every error, typically its artifact directory.
 * @throws {InvalidFragmentError} for a fragment of another version, or a missing or malformed field.
 */
export function parseFragment(value: unknown, source: string): ImageFragment {
  if (!isRecord(value)) {
    throw new InvalidFragmentError(source, 'is not a JSON object.');
  }

  if (value['version'] !== FRAGMENT_VERSION) {
    throw new InvalidFragmentError(
      source,
      `is version ${JSON.stringify(value['version'])}, expected ${FRAGMENT_VERSION}. ` +
        'Pin docker/image-check and docker/image-check-summary to the same release.',
    );
  }

  const warningMib = value['warning_mib'];

  if (typeof warningMib !== 'number' || !Number.isFinite(warningMib) || warningMib < 0) {
    throw new InvalidFragmentError(source, "'warning_mib' is missing or not a non-negative number.");
  }

  return {
    platform: requireString(value, 'platform', PLATFORM, source),
    image: requireString(value, 'image', IMAGE, source),
    sizeBytes: requireCount(value, 'size_bytes', source),
    warningMib,
    findings: requireCount(value, 'findings', source),
    severity: requireString(value, 'severity', SEVERITY, source),
  };
}

/** Parses fragment text, reporting invalid JSON as an invalid fragment. */
export function parseFragmentText(text: string, source: string): ImageFragment {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    throw new InvalidFragmentError(source, 'is not valid JSON.');
  }

  return parseFragment(value, source);
}

/** The fragments that survive deduplication, and the platforms that were described more than once. */
export interface CollectedFragments {
  readonly fragments: readonly ImageFragment[];
  readonly duplicates: readonly string[];
}

/**
 * Keeps one fragment per platform, the last one given, and sorts the result by platform.
 *
 * Sorted so the table does not reorder with job finish times. Two fragments for one platform mean
 * two legs claimed the same label; the later one wins, and the caller warns with the platform.
 */
export function collectFragments(fragments: readonly ImageFragment[]): CollectedFragments {
  const byPlatform = new Map<string, ImageFragment>();
  const duplicates: string[] = [];

  for (const fragment of fragments) {
    if (byPlatform.has(fragment.platform) && !duplicates.includes(fragment.platform)) {
      duplicates.push(fragment.platform);
    }

    byPlatform.set(fragment.platform, fragment);
  }

  const sorted = [...byPlatform.values()].sort((a, b) => compare(a.platform, b.platform));

  return { fragments: sorted, duplicates };
}

/** Code-unit order, so the result is the same under every locale. */
function compare(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}
