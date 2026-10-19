/**
 * The one thing this action reads from `terrace.yaml`: its `cli` pin.
 *
 * Read with the layer's own rules rather than a regular expression over the text, so a pin this
 * action accepts is one the CLI accepts too: `version` must be a layer version this action knows,
 * and `cli` must be a quoted `MAJOR.MINOR` or `MAJOR.MINOR.PATCH`. Every other key is the CLI's to
 * validate, and is left to `terrace-contract doctor`.
 */
import { parseDocument } from 'yaml';

import { InvalidInputError } from './errors.js';
import { parseVersionRequest } from './version.js';

import type { VersionRequest } from './version.js';

/** The file name the CLI discovers, and the one this action reads. */
export const REPO_CONFIG_FILE = 'terrace.yaml';

/** The `terrace.yaml` layer versions this action can read a `cli` pin from. */
const SUPPORTED_LAYER_VERSIONS: readonly number[] = [1];

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `cli` pin `text` declares.
 *
 * @param text the contents of `terrace.yaml`
 * @param file the path it was read from, named in every error so a caller knows what to fix
 */
export function readCliPin(text: string, file: string): VersionRequest {
  const document = parseDocument(text, { prettyErrors: false, uniqueKeys: true });

  if (document.errors.length > 0) {
    throw new InvalidInputError(file, `is not valid YAML: ${document.errors[0]?.message ?? 'parse error'}`);
  }

  const root: unknown = document.toJS();

  if (!isMapping(root)) {
    throw new InvalidInputError(file, 'must be a mapping at the top level.');
  }

  const layer = root.version;

  if (typeof layer !== 'number' || !SUPPORTED_LAYER_VERSIONS.includes(layer)) {
    throw new InvalidInputError(
      file,
      `declares version ${JSON.stringify(layer)}; this action reads version ${SUPPORTED_LAYER_VERSIONS.join(', ')}.`,
    );
  }

  const pin = root.cli;

  if (pin === undefined) {
    throw new InvalidInputError(
      file,
      'declares no cli pin, so there is no terrace-contract version to install. Add `cli: "MAJOR.MINOR"`, or set the version input.',
    );
  }

  // A string only: an unquoted `cli: 0.8` is the float 0.8 to YAML, and `cli: 0.10` would silently
  // read as 0.1. The schema requires a string for the same reason.
  const request = typeof pin === 'string' ? parseVersionRequest(pin) : undefined;

  if (request === undefined) {
    throw new InvalidInputError(
      file,
      `cli must be a quoted MAJOR.MINOR or MAJOR.MINOR.PATCH string, got ${JSON.stringify(pin)}.`,
    );
  }

  return request;
}
