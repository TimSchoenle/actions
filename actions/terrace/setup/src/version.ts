/**
 * Versions of terrace-contract: what a caller asks for, and which published release satisfies it.
 *
 * The rule is the CLI's own `cli` pin rule (spec/helm/v1/REPO.md in TimSchoenle/terrace-config), so
 * the release this action installs is one `terrace-contract doctor` accepts: `MAJOR.MINOR.PATCH`
 * names exactly that release, and `MAJOR.MINOR` takes the newest patch release of that line. Nothing
 * looser is offered, because below 1.0 a minor release may break.
 */

/** A published release. */
export interface ReleaseVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** A requested version: an exact release, or a `MAJOR.MINOR` line when `patch` is absent. */
export interface VersionRequest {
  readonly major: number;
  readonly minor: number;
  readonly patch?: number;
}

/** The tag prefix every terrace-contract release is published under. */
export const RELEASE_TAG_PREFIX = 'terrace-contract-v';

/** A version component: a number without a leading zero, as SemVer requires. */
const COMPONENT = /^(?:0|[1-9]\d*)$/;

/** The numeric components of `text`, or `undefined` unless there are `min` to `max` valid ones. */
function components(text: string, min: number, max: number): number[] | undefined {
  const parts = text.split('.');

  if (parts.length < min || parts.length > max || !parts.every((part) => COMPONENT.test(part))) {
    return undefined;
  }

  return parts.map(Number);
}

/** Parses `MAJOR.MINOR` or `MAJOR.MINOR.PATCH`, or `undefined` when the text is neither. */
export function parseVersionRequest(text: string): VersionRequest | undefined {
  const parts = components(text.trim(), 2, 3);

  if (parts === undefined) {
    return undefined;
  }

  const [major = 0, minor = 0, patch] = parts;

  return patch === undefined ? { major, minor } : { major, minor, patch };
}

/**
 * The release a tag names, or `undefined` for any other tag.
 *
 * A pre-release suffix does not match: a `MAJOR.MINOR` request resolving to a release candidate
 * would install something its publisher has not called finished.
 */
export function parseReleaseTag(tag: string): ReleaseVersion | undefined {
  if (!tag.startsWith(RELEASE_TAG_PREFIX)) {
    return undefined;
  }

  const parts = components(tag.slice(RELEASE_TAG_PREFIX.length), 3, 3);

  if (parts === undefined) {
    return undefined;
  }

  const [major = 0, minor = 0, patch = 0] = parts;

  return { major, minor, patch };
}

/** `MAJOR.MINOR.PATCH`, or `MAJOR.MINOR` for a line request. */
export function formatVersion(version: VersionRequest): string {
  return version.patch === undefined
    ? `${version.major}.${version.minor}`
    : `${version.major}.${version.minor}.${version.patch}`;
}

/** Whether a request names one exact release, so no release listing is needed to resolve it. */
export function isExact(request: VersionRequest): request is ReleaseVersion {
  return request.patch !== undefined;
}

/** The newest of `available` that satisfies `request`, or `undefined` when none does. */
export function selectRelease(
  request: VersionRequest,
  available: readonly ReleaseVersion[],
): ReleaseVersion | undefined {
  let newest: ReleaseVersion | undefined;

  for (const release of available) {
    const satisfies =
      release.major === request.major &&
      release.minor === request.minor &&
      (request.patch === undefined || release.patch === request.patch);

    if (satisfies && (newest === undefined || release.patch > newest.patch)) {
      newest = release;
    }
  }

  return newest;
}
