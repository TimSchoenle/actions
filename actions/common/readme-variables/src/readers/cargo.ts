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
 * table header and reads `key = "value"` only while that header is `[package]` or
 * `[workspace.package]`. A dependency's version sits inside an inline table
 * (`figment = { version = "0.10" }`) and never starts a line, so anchoring to the line start is
 * enough to keep `version` meaning the package's own.
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

/** The two tables a manifest can state its facts in. */
const PACKAGE = 'package';
const WORKSPACE_PACKAGE = 'workspace.package';

interface PackageTable {
  fields: Map<string, string>;
  inherited: Set<string>;
  seen: boolean;
}

function emptyTable(): PackageTable {
  return { fields: new Map(), inherited: new Set(), seen: false };
}

/** Records one assignment inside a package table, ignoring a line that carries no readable field. */
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

/** Collects the `[package]` and `[workspace.package]` tables of one manifest. */
function collectPackageTables(source: string): { member: PackageTable; workspace: PackageTable } {
  const tables = { member: emptyTable(), workspace: emptyTable() };
  let current: PackageTable | undefined;

  for (const raw of source.split('\n')) {
    const line = raw.trim();

    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const header = readTableHeader(line);

    if (header === undefined) {
      if (current !== undefined) {
        readPackageField(line, current);
      }
      continue;
    }

    if (header === PACKAGE) {
      current = tables.member;
    } else if (header === WORKSPACE_PACKAGE) {
      current = tables.workspace;
    } else {
      current = undefined;
    }

    if (current !== undefined) {
      current.seen = true;
    }
  }

  return tables;
}

/**
 * Resolves the fields a manifest states for itself.
 *
 * `[package]` wins when present, with each `field.workspace = true` taken from `[workspace.package]`
 * in the same file. A virtual workspace has no `[package]`, so its `[workspace.package]` is the
 * whole answer. An inherited field the file cannot resolve stays in `inherited`, for the error.
 */
function resolveFields(member: PackageTable, workspace: PackageTable): PackageTable {
  if (!member.seen) {
    return workspace;
  }

  const fields = new Map(member.fields);
  const inherited = new Set<string>();

  for (const field of member.inherited) {
    const value = workspace.fields.get(field);

    if (value === undefined) {
      inherited.add(field);
    } else if (!fields.has(field)) {
      fields.set(field, value);
    }
  }

  return { fields, inherited, seen: true };
}

/**
 * Reads the facts a README quotes out of a `Cargo.toml`.
 *
 * A package manifest is read from `[package]`, resolving inherited fields against a
 * `[workspace.package]` in the same file. A virtual workspace manifest is read from
 * `[workspace.package]`, and has no `name` to report.
 *
 * @throws {ManifestParseError} if the file has neither table.
 * @throws {ManifestFieldMissingError} if `version` is absent, or inherited from a workspace this
 * file does not define.
 */
export function readCargoManifest(source: string, manifestPath: string): ManifestFacts {
  const { member, workspace } = collectPackageTables(source);

  if (!member.seen && !workspace.seen) {
    throw new ManifestParseError(
      manifestPath,
      'no [package] or [workspace.package] table. Add one, or point `manifest` at a manifest that has one.',
    );
  }

  const { fields, inherited } = resolveFields(member, workspace);
  const version = fields.get('version');

  if (version === undefined) {
    throw new ManifestFieldMissingError(
      manifestPath,
      member.seen ? 'package.version' : 'workspace.package.version',
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
    name: member.seen ? fields.get('name') : undefined,
    version,
    description: fields.get('description'),
    license: fields.get('license'),
    homepage: fields.get('homepage'),
    toolchain,
  };
}
