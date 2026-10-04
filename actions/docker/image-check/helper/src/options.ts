/**
 * Turns the raw composite inputs into the validated options every later phase works from.
 *
 * Pure over strings, so every rule here is unit-tested without a runner. It runs in the measure
 * phase, before Trivy, so a typo in a threshold fails the step in a second rather than after a scan.
 *
 * Inputs are reported under the composite's kebab-case names, which is what the workflow author wrote.
 */
import { InvalidInputError } from './errors.js';
import { parseImageReference } from './image-reference.js';

/** What the action does with its result on a pull request. */
export type CommentMode = 'none' | 'per-image' | 'summary';

const COMMENT_MODES: readonly CommentMode[] = ['per-image', 'summary', 'none'];

/** Trivy's severities, most severe first, which is also the order they are rendered in. */
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;

/** One `/`-separated component of a platform label, e.g. `linux`, `arm64`, `v7`. */
const PLATFORM_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Most components a platform label has: `os/arch/variant`, plus one in reserve. */
const MAX_PLATFORM_COMPONENTS = 4;

/**
 * Longest platform label accepted.
 *
 * The slug ends up in `docker-image-size-<slug>`, and upsert-pr-comment caps an identifier at 64
 * characters, so 40 leaves the derived identifier inside that limit.
 */
const MAX_PLATFORM_LENGTH = 40;

/** The whole part of a size in MiB. Bounded, so no input makes the check itself expensive. */
const WHOLE_MEBIBYTES = /^\d{1,7}$/;

/** The fractional part of a size in MiB, when there is one. */
const FRACTIONAL_MEBIBYTES = /^\d{1,3}$/;

/** upsert-pr-comment's identifier grammar, checked here so a bad value fails before the scan. */
const COMMENT_IDENTIFIER = /^[A-Za-z0-9._-]{1,64}$/;

/** A code scanning category: printable, no whitespace, short enough to be a label. */
const SARIF_CATEGORY = /^[A-Za-z0-9._/:=-]{1,128}$/;

/**
 * Characters trivy-action's entrypoint cannot carry in an ignore-file path.
 *
 * It splits `trivyignores` on commas and then word-splits the result unquoted, so a path holding
 * either becomes two paths, or a glob.
 */
const IGNORE_FILE_UNSAFE = /[\s,*?[\]]/;

/** The raw strings the composite hands over, keyed by the composite's own input names. */
export interface RawInputs {
  readonly image: string;
  readonly platform: string;
  readonly sizeWarningMib: string;
  readonly sizeLimitMib: string;
  readonly trivySeverity: string;
  readonly trivyIgnoreUnfixed: string;
  readonly trivyFailOnFindings: string;
  readonly trivyIgnoreFile: string;
  readonly uploadSarif: string;
  readonly sarifCategory: string;
  readonly comment: string;
  readonly commentIdentifier: string;
}

/** Everything the inputs mean, validated and with every default derived. */
export interface CheckOptions {
  readonly image: string;
  /** Empty when the caller named no platform. */
  readonly platform: string;
  /** `platform` as a slug, e.g. `linux-arm64`. Empty when `platform` is. */
  readonly slug: string;
  /** 0 when disabled. */
  readonly warningMib: number;
  /** 0 when disabled. */
  readonly limitMib: number;
  /** Comma-separated, most severe first, e.g. `CRITICAL,HIGH`. */
  readonly severity: string;
  readonly ignoreUnfixed: boolean;
  readonly failOnFindings: boolean;
  /** Workspace-relative path as written, or empty. */
  readonly ignoreFile: string;
  readonly uploadSarif: boolean;
  /** Empty keeps upload-sarif's own default category. */
  readonly sarifCategory: string;
  readonly comment: CommentMode;
  readonly commentIdentifier: string;
}

/**
 * Derives the slug of a platform label: lower case, `/` replaced by `-`.
 *
 * The slug keeps two matrix legs apart in the SARIF category, the comment identifier and the
 * fragment's artifact name, so it must be stable for one label and distinct between real platforms.
 * Case is folded because `linux/ARM64` and `linux/arm64` are the same platform to Docker.
 */
export function platformSlug(platform: string): string {
  return platform.toLowerCase().replaceAll('/', '-');
}

function parsePlatform(value: string): string {
  const platform = value.trim();

  if (platform === '') {
    return '';
  }

  if (platform.length > MAX_PLATFORM_LENGTH) {
    throw new InvalidInputError(
      'platform',
      `is ${platform.length} characters, past the ${MAX_PLATFORM_LENGTH}-character limit.`,
    );
  }

  const components = platform.split('/');

  if (components.length > MAX_PLATFORM_COMPONENTS || !components.every((part) => PLATFORM_COMPONENT.test(part))) {
    throw new InvalidInputError(
      'platform',
      `'${platform}' is not a platform label. Expected components such as linux/arm64 or linux/arm/v7.`,
    );
  }

  return platform;
}

/** Parses a threshold in MiB. `0` disables it, which is a value rather than an absence. */
export function parseMebibytes(input: string, value: string): number {
  const trimmed = value.trim();

  const [whole, fraction, ...rest] = trimmed.split('.');
  const valid =
    WHOLE_MEBIBYTES.test(whole) && (fraction === undefined || FRACTIONAL_MEBIBYTES.test(fraction)) && rest.length === 0;

  if (!valid) {
    throw new InvalidInputError(input, `'${trimmed}' is not a size in MiB. Expected a number such as 150 or 0.`);
  }

  return Number(trimmed);
}

/** Parses a boolean the way `core.getBooleanInput` does, under the composite's input name. */
export function parseBoolean(input: string, value: string): boolean {
  const trimmed = value.trim();

  if (['true', 'True', 'TRUE'].includes(trimmed)) {
    return true;
  }

  if (['false', 'False', 'FALSE'].includes(trimmed)) {
    return false;
  }

  throw new InvalidInputError(input, `'${trimmed}' is not a boolean. Expected true or false.`);
}

/**
 * Normalises a severity list: upper case, deduplicated, most severe first.
 *
 * Validated rather than passed through because Trivy reads an unknown severity as an error only
 * after it has downloaded its database, which turns a typo into a minute-long failure.
 */
export function parseSeverity(value: string): string {
  const requested = new Set(
    value
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter((part) => part !== ''),
  );

  if (requested.size === 0) {
    throw new InvalidInputError('trivy-severity', `must name at least one of ${SEVERITIES.join(', ')}.`);
  }

  for (const severity of requested) {
    if (!(SEVERITIES as readonly string[]).includes(severity)) {
      throw new InvalidInputError(
        'trivy-severity',
        `'${severity}' is not a Trivy severity. Expected some of ${SEVERITIES.join(', ')}.`,
      );
    }
  }

  return SEVERITIES.filter((severity) => requested.has(severity)).join(',');
}

function parseCommentMode(value: string): CommentMode {
  const mode = value.trim();

  if (!(COMMENT_MODES as readonly string[]).includes(mode)) {
    throw new InvalidInputError('comment', `'${mode}' is not a comment mode. Expected ${COMMENT_MODES.join(', ')}.`);
  }

  return mode as CommentMode;
}

function resolveCommentIdentifier(value: string, slug: string): string {
  const explicit = value.trim();

  if (explicit === '') {
    return slug === '' ? 'docker-image-size' : `docker-image-size-${slug}`;
  }

  if (!COMMENT_IDENTIFIER.test(explicit)) {
    throw new InvalidInputError(
      'comment-identifier',
      `'${explicit}' is not an identifier. Expected 1 to 64 letters, digits, '.', '_' or '-'.`,
    );
  }

  return explicit;
}

/**
 * Resolves the SARIF category, or the empty string that leaves upload-sarif's default in place.
 *
 * Without a platform it stays empty on purpose: a repository that scanned one image under the
 * default category keeps its existing alerts, instead of seeing them all closed and reopened under
 * a new one.
 */
function resolveSarifCategory(value: string, slug: string): string {
  const explicit = value.trim();

  if (explicit === '') {
    return slug === '' ? '' : `trivy-${slug}`;
  }

  if (!SARIF_CATEGORY.test(explicit)) {
    throw new InvalidInputError(
      'sarif-category',
      `'${explicit}' is not a category. Expected up to 128 letters, digits or any of . _ / : = -.`,
    );
  }

  return explicit;
}

/**
 * Validates the ignore-file path without resolving it: Trivy reads it relative to the workspace.
 *
 * @param resolve - resolves the path beneath the workspace, throwing when it escapes. Injected so
 * this module stays free of the filesystem.
 */
function parseIgnoreFile(value: string, resolve: (path: string) => string): string {
  const path = value.trim();

  if (path === '') {
    return '';
  }

  if (IGNORE_FILE_UNSAFE.test(path)) {
    throw new InvalidInputError(
      'trivy-ignore-file',
      'must not contain whitespace, commas or glob characters; trivy-action splits the path on them.',
    );
  }

  resolve(path);

  return path;
}

/**
 * Validates every input and derives the defaults that depend on the platform.
 *
 * @param resolveWithinWorkspace - throws when a path leaves the workspace.
 * @throws {InvalidInputError} naming the first input that is not usable.
 */
export function resolveOptions(raw: RawInputs, resolveWithinWorkspace: (path: string) => string): CheckOptions {
  const image = parseImageReference(raw.image);
  const platform = parsePlatform(raw.platform);
  const slug = platformSlug(platform);
  const comment = parseCommentMode(raw.comment);

  // The fragment's artifact name and the summary row are both keyed by platform; without one, two
  // legs would overwrite each other's fragment and the table could not say which row is which.
  if (comment === 'summary' && platform === '') {
    throw new InvalidInputError('platform', "is required when comment is 'summary'; it names the table row.");
  }

  return {
    image,
    platform,
    slug,
    warningMib: parseMebibytes('size-warning-mib', raw.sizeWarningMib),
    limitMib: parseMebibytes('size-limit-mib', raw.sizeLimitMib),
    severity: parseSeverity(raw.trivySeverity),
    ignoreUnfixed: parseBoolean('trivy-ignore-unfixed', raw.trivyIgnoreUnfixed),
    failOnFindings: parseBoolean('trivy-fail-on-findings', raw.trivyFailOnFindings),
    ignoreFile: parseIgnoreFile(raw.trivyIgnoreFile, resolveWithinWorkspace),
    uploadSarif: parseBoolean('upload-sarif', raw.uploadSarif),
    sarifCategory: resolveSarifCategory(raw.sarifCategory, slug),
    comment,
    commentIdentifier: resolveCommentIdentifier(raw.commentIdentifier, slug),
  };
}
