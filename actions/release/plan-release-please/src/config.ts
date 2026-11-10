import { toRepoPath } from 'action-graph';

/** The release-please settings that decide a package's tag and changelog, after defaults are applied. */
export interface PackageSettings {
  /** The package path, the key in the configuration and the manifest. `.` for the root package. */
  readonly path: string;
  /** The component, or `undefined` when the tag carries none. */
  readonly component: string | undefined;
  readonly tagSeparator: string;
  readonly includeV: boolean;
  /** The changelog, relative to the repository root. */
  readonly changelogPath: string;
}

/** Raised for a configuration or manifest this action cannot interpret exactly as release-please does. */
export class ReleaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseConfigError';
  }
}

const TAG_SEPARATOR = 'tag-separator';
const CHANGELOG_PATH = 'changelog-path';
const INCLUDE_V = 'include-v-in-tag';
const INCLUDE_COMPONENT = 'include-component-in-tag';

/** {@link toRepoPath}, reporting a bad path as a configuration error. */
function configPath(value: string, where: string): string {
  try {
    return toRepoPath(value, where);
  } catch (error) {
    throw new ReleaseConfigError((error as Error).message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string, file: string): Record<string, unknown> {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new ReleaseConfigError(`${file}: not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(document)) {
    throw new ReleaseConfigError(`${file}: expected a JSON object.`);
  }

  return document;
}

function readString(record: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ReleaseConfigError(`${where}: '${key}' must be a string.`);
  }

  return value;
}

function readBoolean(record: Record<string, unknown>, key: string, where: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ReleaseConfigError(`${where}: '${key}' must be true or false.`);
  }

  return value;
}

/**
 * Reads every package's tag and changelog settings from release-please's configuration.
 *
 * Defaults follow release-please: separator `-`, `v` in the tag, component in the tag, changelog
 * `CHANGELOG.md` in the package. A top-level value applies to every package that sets none. A package
 * whose tag includes a component must name it with `component`: release-please would otherwise derive
 * one from the release type, which this action does not reproduce.
 *
 * @throws {@link ReleaseConfigError} for malformed JSON, a wrong type, or a component it cannot know
 */
export function parseReleaseConfig(text: string, file: string): PackageSettings[] {
  const config = parseJson(text, file);
  const packages = config['packages'];
  if (!isRecord(packages) || Object.keys(packages).length === 0) {
    throw new ReleaseConfigError(`${file}: 'packages' must be a non-empty object.`);
  }

  // Validated once up front, so a wrong top-level type is reported against the top level even when
  // every package overrides it.
  readString(config, TAG_SEPARATOR, file);
  readString(config, CHANGELOG_PATH, file);
  readBoolean(config, INCLUDE_V, file);
  readBoolean(config, INCLUDE_COMPONENT, file);

  return Object.entries(packages)
    .map(([key, value]) => {
      const where = `${file}: packages.${key}`;
      if (!isRecord(value)) {
        throw new ReleaseConfigError(`${where} must be an object.`);
      }
      const path = configPath(key, where);
      const pickString = (name: string, fallback: string): string =>
        readString(value, name, where) ?? readString(config, name, file) ?? fallback;
      const pickBoolean = (name: string, fallback: boolean): boolean =>
        readBoolean(value, name, where) ?? readBoolean(config, name, file) ?? fallback;

      const includeComponent = pickBoolean(INCLUDE_COMPONENT, true);
      const component = readString(value, 'component', where);
      if (includeComponent && (component === undefined || component === '')) {
        throw new ReleaseConfigError(`${where} includes the component in its tag but sets no 'component'.`);
      }
      const changelog = pickString(CHANGELOG_PATH, 'CHANGELOG.md');

      return {
        path,
        component: includeComponent ? component : undefined,
        tagSeparator: pickString(TAG_SEPARATOR, '-'),
        includeV: pickBoolean(INCLUDE_V, true),
        changelogPath: configPath(path === '.' ? changelog : `${path}/${changelog}`, `${where} changelog-path`),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Whether `value` is `MAJOR.MINOR.PATCH` with an optional pre-release or build suffix, as release-please writes. */
function isVersion(value: string): boolean {
  const suffixAt = value.search(/[-+]/);
  const core = suffixAt === -1 ? value : value.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? '' : value.slice(suffixAt + 1);

  return /^\d+\.\d+\.\d+$/.test(core) && (suffixAt === -1 || /^[0-9A-Za-z.+-]+$/.test(suffix));
}

/**
 * Reads the manifest: package path to version.
 *
 * @throws {@link ReleaseConfigError} for malformed JSON or a value that is not a version
 */
export function parseManifest(text: string, file: string): Map<string, string> {
  const manifest = parseJson(text, file);
  const versions = new Map<string, string>();
  for (const [key, value] of Object.entries(manifest)) {
    if (typeof value !== 'string' || !isVersion(value)) {
      throw new ReleaseConfigError(`${file}: '${key}' must map to a version; got ${JSON.stringify(value)}.`);
    }
    versions.set(configPath(key, `${file}: '${key}'`), value);
  }

  return versions;
}

/** The tag release-please creates for `version` of a package: `<component><separator>v<version>`. */
export function releasePleaseTag(settings: PackageSettings, version: string): string {
  const prefix = settings.component === undefined ? '' : `${settings.component}${settings.tagSeparator}`;

  return `${prefix}${settings.includeV ? 'v' : ''}${version}`;
}
