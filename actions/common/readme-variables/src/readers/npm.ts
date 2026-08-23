import { ManifestFieldMissingError, ManifestParseError } from '../errors.js';

import type { ManifestFacts } from '../manifest.js';

/** Whether a parsed JSON value is a plain object, which is the only shape a manifest may be. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a field only when it is a string.
 *
 * `license` may legitimately be an object in older manifests and `description` may be absent
 * entirely. Both are omitted rather than stringified, because `[object Object]` in a README is worse
 * than a section the template's strict mode refuses to render.
 */
function stringField(manifest: Record<string, unknown>, key: string): string | undefined {
  const value = manifest[key];

  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads the facts a README quotes out of a `package.json`.
 *
 * @throws {ManifestParseError} if the file is not a JSON object.
 * @throws {ManifestFieldMissingError} if `version` is absent or not a string.
 */
export function readNpmManifest(source: string, manifestPath: string): ManifestFacts {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new ManifestParseError(manifestPath, 'not valid JSON.', error);
  }

  if (!isPlainObject(parsed)) {
    throw new ManifestParseError(manifestPath, 'the top level is not a JSON object.');
  }

  const version = stringField(parsed, 'version');

  if (version === undefined) {
    throw new ManifestFieldMissingError(manifestPath, 'version');
  }

  const toolchain: Record<string, string> = {};
  const { engines } = parsed;

  if (isPlainObject(engines) && typeof engines['node'] === 'string') {
    toolchain['node'] = engines['node'];
  }

  return {
    kind: 'npm',
    name: stringField(parsed, 'name'),
    version,
    description: stringField(parsed, 'description'),
    license: stringField(parsed, 'license'),
    homepage: stringField(parsed, 'homepage'),
    toolchain,
  };
}
