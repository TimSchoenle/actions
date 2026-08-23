import { ManifestFieldMissingError, ManifestParseError } from '../errors.js';

import type { ManifestFacts } from '../manifest.js';

/**
 * The `[package]` fields of a `Cargo.toml`, read without a TOML parser.
 *
 * A dependency is not taken for this on purpose. What a README quotes is a handful of top-level
 * string fields in one table, all of them version strings or one-line prose, and a full parser buys
 * nothing for them while adding a bundled dependency to every action that reads a manifest.
 *
 * The parse is deliberately shallow, and its limits are the reason it is safe: it tracks the current
 * table header and reads `key = "value"` only while that header is `[package]`. A dependency's
 * version sits inside an inline table (`figment = { version = "0.10" }`) and never starts a line, so
 * anchoring to the line start is enough to keep `version` meaning the package's own.
 *
 * Scanned character by character rather than matched with a pattern. The obvious regex for a quoted
 * value nests a quantifier inside another one, which is the shape that backtracks quadratically on a
 * malformed line — and a manifest is exactly the kind of file that arrives malformed.
 */

/** A bare TOML key. No quantifier nests inside another, so this cannot backtrack. */
const BARE_KEY = /^[A-Za-z][\w-]*$/;

/** The escapes a basic string can carry that mean something other than the character itself. */
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t' };

/** The suffix marking a field inherited from the workspace, e.g. `version.workspace = true`. */
const WORKSPACE_SUFFIX = '.workspace';

/** Splits `lhs = rhs` at the first `=`. Everything else on the line is left to the caller. */
function splitAssignment(line: string): { lhs: string; rhs: string } | undefined {
  const separator = line.indexOf('=');

  return separator === -1
    ? undefined
    : { lhs: line.slice(0, separator).trimEnd(), rhs: line.slice(separator + 1).trimStart() };
}

/**
 * Reads a TOML basic string from the start of `rhs`, returning nothing if it is not one.
 *
 * Stops at the closing quote, so a trailing comment after the value is discarded with no second
 * pass. An unterminated string yields nothing rather than the rest of the line: a manifest that
 * cannot be read should leave the field absent, and the caller reports that with a path attached.
 */
export function readBasicString(rhs: string): string | undefined {
  if (!rhs.startsWith('"')) {
    return undefined;
  }

  let value = '';

  for (let index = 1; index < rhs.length; index++) {
    const character = rhs[index];

    if (character === '"') {
      return value;
    }

    if (character !== '\\') {
      value += character;
      continue;
    }

    const escaped = rhs[index + 1];

    if (escaped === undefined) {
      return undefined;
    }

    value += ESCAPES[escaped] ?? escaped;
    index++;
  }

  return undefined;
}

/** Reads a table header, e.g. `[package]` or `[dependencies.serde]`, from a trimmed line. */
function readTableHeader(line: string): string | undefined {
  if (!line.startsWith('[')) {
    return undefined;
  }

  const close = line.indexOf(']');

  return close === -1 ? undefined : line.slice(1, close).trim();
}

interface PackageTable {
  fields: Map<string, string>;
  inherited: Set<string>;
  seen: boolean;
}

/** Records one assignment inside `[package]`, ignoring a line that carries no readable field. */
function readPackageField(line: string, table: PackageTable): void {
  const assignment = splitAssignment(line);

  if (assignment === undefined) {
    return;
  }

  const { lhs, rhs } = assignment;

  if (lhs.endsWith(WORKSPACE_SUFFIX) && rhs.startsWith('true')) {
    table.inherited.add(lhs.slice(0, -WORKSPACE_SUFFIX.length));
    return;
  }

  const value = BARE_KEY.test(lhs) ? readBasicString(rhs) : undefined;

  // First writer wins: a duplicate key is invalid TOML, and keeping the first keeps the parse
  // deterministic rather than quietly preferring whichever came last.
  if (value !== undefined && !table.fields.has(lhs)) {
    table.fields.set(lhs, value);
  }
}

/** Collects the `[package]` table, and which of its fields defer to the workspace. */
function collectPackageTable(source: string): PackageTable {
  const table: PackageTable = { fields: new Map(), inherited: new Set(), seen: false };
  let inPackage = false;

  for (const raw of source.split('\n')) {
    const line = raw.trim();

    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const header = readTableHeader(line);

    if (header !== undefined) {
      inPackage = header === 'package';
      table.seen ||= inPackage;
    } else if (inPackage) {
      readPackageField(line, table);
    }
  }

  return table;
}

/**
 * Reads the facts a README quotes out of a `Cargo.toml`.
 *
 * @throws {ManifestParseError} if the file has no `[package]` table.
 * @throws {ManifestFieldMissingError} if `version` is absent or inherited from the workspace.
 */
export function readCargoManifest(source: string, manifestPath: string): ManifestFacts {
  const { fields, inherited, seen } = collectPackageTable(source);

  if (!seen) {
    throw new ManifestParseError(
      manifestPath,
      'no [package] table. A virtual workspace manifest describes no package; point `manifest` at a member.',
    );
  }

  const version = fields.get('version');

  if (version === undefined) {
    throw new ManifestFieldMissingError(
      manifestPath,
      'package.version',
      inherited.has('version')
        ? 'It is inherited with `version.workspace = true`; point `manifest` at the workspace root instead.'
        : undefined,
    );
  }

  const toolchain: Record<string, string> = {};

  for (const [field, name] of [
    ['rust-version', 'msrv'],
    ['edition', 'edition'],
  ] as const) {
    const value = fields.get(field);

    if (value !== undefined) {
      toolchain[name] = value;
    }
  }

  return {
    kind: 'cargo',
    name: fields.get('name'),
    version,
    description: fields.get('description'),
    license: fields.get('license'),
    homepage: fields.get('homepage'),
    toolchain,
  };
}
