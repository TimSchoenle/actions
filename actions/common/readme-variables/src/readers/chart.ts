import { parse } from 'yaml';

import { ManifestFieldMissingError, ManifestParseError } from '../errors.js';

import type { ManifestFacts } from '../manifest.js';

/** Whether a parsed YAML value is a mapping, which is the only shape a `Chart.yaml` may be. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a field only when it is a string.
 *
 * `appVersion` is the field this matters for: YAML reads an unquoted `2.7.1` as a string but an
 * unquoted `1.2` as a number, and a chart that quotes neither would otherwise put `1.2` in one
 * README and `"1.2"` in another. A non-string is coerced rather than dropped, because a version is
 * still a version when the author forgot the quotes.
 */
function versionField(chart: Record<string, unknown>, key: string): string | undefined {
  const value = chart[key];

  if (typeof value === 'string') {
    return value;
  }

  return typeof value === 'number' ? String(value) : undefined;
}

function stringField(chart: Record<string, unknown>, key: string): string | undefined {
  const value = chart[key];

  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads the facts a README quotes out of a Helm `Chart.yaml`.
 *
 * `version` is the chart's own version, which is what a `helm install` pins and therefore what the
 * README's release line states. `appVersion` — the image the chart deploys — moves independently and
 * is carried in `toolchain` alongside `kubeVersion`, since both belong to the compatibility table.
 *
 * @throws {ManifestParseError} if the file is not a YAML mapping.
 * @throws {ManifestFieldMissingError} if `version` is absent.
 */
export function readChartManifest(source: string, manifestPath: string): ManifestFacts {
  let parsed: unknown;

  try {
    parsed = parse(source);
  } catch (error) {
    throw new ManifestParseError(manifestPath, 'not valid YAML.', error);
  }

  if (!isMapping(parsed)) {
    throw new ManifestParseError(manifestPath, 'the top level is not a YAML mapping.');
  }

  const version = versionField(parsed, 'version');

  if (version === undefined) {
    throw new ManifestFieldMissingError(manifestPath, 'version');
  }

  const toolchain: Record<string, string> = {};

  for (const key of ['appVersion', 'kubeVersion'] as const) {
    const value = versionField(parsed, key);

    if (value !== undefined) {
      toolchain[key] = value;
    }
  }

  return {
    kind: 'chart',
    name: stringField(parsed, 'name'),
    version,
    description: stringField(parsed, 'description'),
    homepage: stringField(parsed, 'home'),
    toolchain,
  };
}
