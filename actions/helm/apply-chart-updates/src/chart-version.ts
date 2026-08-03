/**
 * Chart version arithmetic.
 *
 * Helm requires `Chart.yaml`'s `version` to be SemVer 2, so this parses it as SemVer rather than as
 * "some dot-separated numbers". The shell predecessor incremented the last dot-separated field with
 * `awk`, which turned `1.2.3-rc.1` into `1.2.3-rc.2` and `1.2` into `1.3` — neither a valid bump of
 * a chart version, and both silently accepted.
 */

/** `major.minor.patch`, with the prerelease and build parts already split off. */
const VERSION_CORE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * A prerelease or build part, as one flat character class rather than the spec's dot-separated
 * identifier grammar. Deliberately: the version is split on its delimiters first, so every pattern
 * here stays a single unnested quantifier — no backtracking hazard — and the extra strings this
 * accepts (`1.0.0-a..b`) are ones Helm tolerates anyway.
 */
const VERSION_PART = /^[0-9A-Za-z.-]+$/;

/** How to derive the next chart version. */
export type BumpKind = 'patch' | 'minor' | 'major' | 'none';

const BUMP_KINDS: readonly BumpKind[] = ['patch', 'minor', 'major', 'none'];

/** Raised for a version that is not SemVer, or a bump kind that is not one of the four. */
export class InvalidVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidVersionError';
  }
}

interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | undefined;
}

function parseSemver(version: string, label: string): Semver {
  // Split on the delimiters, in the order SemVer defines them: build metadata is everything after
  // the first `+`, and the prerelease everything after the first `-` in what remains.
  const [beforeBuild, ...build] = version.split('+');

  const separator = beforeBuild.indexOf('-');
  const core = separator === -1 ? beforeBuild : beforeBuild.slice(0, separator);
  const prerelease = separator === -1 ? undefined : beforeBuild.slice(separator + 1);

  const match = VERSION_CORE.exec(core);

  if (
    match === null ||
    build.length > 1 ||
    !build.every((part) => VERSION_PART.test(part)) ||
    (prerelease !== undefined && !VERSION_PART.test(prerelease))
  ) {
    throw new InvalidVersionError(`${label} '${version}' is not a valid SemVer version`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

/** Validates an explicitly supplied version and returns it unchanged. */
export function assertSemver(version: string, label: string): string {
  parseSemver(version, label);

  return version;
}

/** Parses the `version-bump` input. */
export function parseBumpKind(raw: string): BumpKind {
  const candidate = raw.trim();

  if (!BUMP_KINDS.includes(candidate as BumpKind)) {
    throw new InvalidVersionError(`version-bump must be one of ${BUMP_KINDS.join(', ')}, got '${raw}'`);
  }

  return candidate as BumpKind;
}

/**
 * Returns the next chart version.
 *
 * Follows the conventional SemVer increment: bumping a prerelease *releases* it rather than moving
 * past it, so `1.2.3-rc.1` patches to `1.2.3`. Build metadata is dropped, because it describes the
 * build the version was cut from and carries nothing forward.
 */
export function bumpChartVersion(current: string, kind: BumpKind): string {
  const { major, minor, patch, prerelease } = parseSemver(current, 'Chart version');

  if (kind === 'none') {
    return current;
  }

  if (kind === 'major') {
    return prerelease !== undefined && minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`;
  }

  if (kind === 'minor') {
    return prerelease !== undefined && patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`;
  }

  return prerelease === undefined ? `${major}.${minor}.${patch + 1}` : `${major}.${minor}.${patch}`;
}
