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
 * enough to keep `version` meaning the package's own. Lines inside a multiline string are skipped,
 * so text that looks like an assignment inside a long `description` is never read as one. A field
 * whose value is itself a multiline string is left absent rather than read.
 *
 * Scanned character by character rather than matched with a pattern. The obvious regex for a quoted
 * value nests a quantifier inside another one, which is the shape that backtracks quadratically on a
 * malformed line — and a manifest is exactly the kind of file that arrives malformed.
 */

/** A bare TOML key. No quantifier nests inside another, so this cannot backtrack. */
const BARE_KEY = /^[A-Za-z0-9_-]+$/;

/** The escapes a basic string can carry that mean something other than the character itself. */
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t' };

/** The delimiters of the two multiline string forms. */
const MULTILINE_BASIC = '"""';
const MULTILINE_LITERAL = "'''";

type Multiline = typeof MULTILINE_BASIC | typeof MULTILINE_LITERAL;

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
 * A multiline string (`"""`) is not a basic string and yields nothing.
 */
export function readBasicString(rhs: string): string | undefined {
  return rhs.startsWith(MULTILINE_BASIC) ? undefined : readQuoted(rhs, 0)?.value;
}

/**
 * Reads the basic (`"`) or literal (`'`) string that opens at `start`, with the index just past its
 * closing quote. A literal string has no escapes. An unterminated string yields nothing.
 */
function readQuoted(text: string, start: number): { value: string; end: number } | undefined {
  const quote = text[start];

  if (quote !== '"' && quote !== "'") {
    return undefined;
  }

  let value = '';

  for (let index = start + 1; index < text.length; index++) {
    const character = text[index];

    if (character === quote) {
      return { value, end: index + 1 };
    }

    if (quote === "'" || character !== '\\') {
      value += character;
      continue;
    }

    const escaped = text[index + 1];

    if (escaped === undefined) {
      return undefined;
    }

    value += ESCAPES[escaped] ?? escaped;
    index++;
  }

  return undefined;
}

/** The index of the first character at or after `index` that is not a space or a tab. */
function skipBlanks(text: string, index: number): number {
  let next = index;

  while (text[next] === ' ' || text[next] === '\t') {
    next++;
  }

  return next;
}

/** Reads one bare or quoted key part at `index`, with the index just past it. */
function readKeyPart(text: string, index: number): { value: string; end: number } | undefined {
  const quoted = readQuoted(text, index);

  if (quoted !== undefined) {
    return quoted;
  }

  const length = text.slice(index).search(/[\s.]/u);
  const value = length === -1 ? text.slice(index) : text.slice(index, index + length);

  return BARE_KEY.test(value) ? { value, end: index + value.length } : undefined;
}

/**
 * Reads a TOML key into its parts, or nothing if `text` is not a valid key.
 *
 * Each part is a bare key or a quoted one, and TOML allows whitespace around each `.`, so
 * `workspace . "package"` reads as `['workspace', 'package']`. A quoted part may contain a dot,
 * which is why the parts are kept apart rather than joined.
 */
function readKey(text: string): readonly string[] | undefined {
  const parts: string[] = [];
  let index = 0;

  for (;;) {
    const part = readKeyPart(text, skipBlanks(text, index));

    if (part === undefined) {
      return undefined;
    }

    parts.push(part.value);
    index = skipBlanks(text, part.end);

    if (index === text.length) {
      return parts;
    }

    if (text[index] !== '.') {
      return undefined;
    }

    index++;
  }
}

/** Whether `key` is exactly `expected`, part for part. */
function keyIs(key: readonly string[] | undefined, ...expected: string[]): boolean {
  return key !== undefined && key.length === expected.length && key.every((part, index) => part === expected[index]);
}

/**
 * Reads a table header, e.g. `[package]` or `[dependencies.serde]`, from a trimmed line.
 *
 * Returns nothing when the line is not a header. A header whose key cannot be read, such as an
 * array of tables (`[[bin]]`), is still a header, and comes back with no key.
 */
function readTableHeader(line: string): { key: readonly string[] | undefined } | undefined {
  if (!line.startsWith('[')) {
    return undefined;
  }

  const close = line.indexOf(']');

  return close === -1 ? undefined : { key: readKey(line.slice(1, close)) };
}

/**
 * Whether `rhs` marks a field as inherited. Cargo accepts the dotted form, `version.workspace =
 * true`, whose value is `true`, and the inline-table form, `version = { workspace = true }`.
 */
function isInlineWorkspaceTable(rhs: string): boolean {
  if (!rhs.startsWith('{')) {
    return false;
  }

  const close = rhs.indexOf('}');

  if (close === -1) {
    return false;
  }

  return rhs
    .slice(1, close)
    .split(',')
    .some((entry) => {
      const assignment = splitAssignment(entry.trim());

      return (
        assignment !== undefined && keyIs(readKey(assignment.lhs), 'workspace') && assignment.rhs.trimEnd() === 'true'
      );
    });
}

/**
 * The index just past the `delimiter` that closes a multiline string, scanning from `index`, or
 * nothing when the string is still open at the end of `line`.
 *
 * A basic string's backslash escapes the next character, so `\"""` closes nothing. TOML lets up to
 * two more quotes sit against the closing delimiter as content.
 */
function endOfMultiline(line: string, index: number, delimiter: Multiline): number | undefined {
  for (let next = index; next < line.length; next++) {
    if (delimiter === MULTILINE_BASIC && line[next] === '\\') {
      next++;
    } else if (line.startsWith(delimiter, next)) {
      let run = delimiter.length;

      while (run < delimiter.length + 2 && line[next + run] === delimiter[0]) {
        run++;
      }

      return next + run;
    }
  }

  return undefined;
}

/** The multiline string delimiter that opens at `index`, if one does. */
function multilineOpeningAt(line: string, index: number): Multiline | undefined {
  const delimiters: readonly Multiline[] = [MULTILINE_BASIC, MULTILINE_LITERAL];

  return delimiters.find((delimiter) => line.startsWith(delimiter, index));
}

/**
 * The multiline string still open at the end of `line`, given the one open at its start.
 *
 * Single-line strings are stepped over whole, so a quote inside one opens nothing, and a `#`
 * outside any string ends the scan as a comment.
 */
function multilineOpenAfter(line: string, open: Multiline | undefined): Multiline | undefined {
  let index = 0;

  if (open !== undefined) {
    const end = endOfMultiline(line, 0, open);

    if (end === undefined) {
      return open;
    }

    index = end;
  }

  while (index < line.length && line[index] !== '#') {
    const opening = multilineOpeningAt(line, index);

    if (opening === undefined) {
      index = readQuoted(line, index)?.end ?? index + 1;
      continue;
    }

    const end = endOfMultiline(line, index + opening.length, opening);

    if (end === undefined) {
      return opening;
    }

    index = end;
  }

  return undefined;
}

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
  const key = assignment === undefined ? undefined : readKey(assignment.lhs);

  if (assignment === undefined || key === undefined) {
    return;
  }

  const { rhs } = assignment;

  if (key.length === 2 && key[1] === 'workspace' && rhs.startsWith('true')) {
    table.inherited.add(key[0]);
    return;
  }

  if (key.length !== 1) {
    return;
  }

  const [field] = key;

  if (isInlineWorkspaceTable(rhs)) {
    table.inherited.add(field);
    return;
  }

  const value = readBasicString(rhs);

  // First writer wins: a duplicate key is invalid TOML, and keeping the first keeps the parse
  // deterministic rather than quietly preferring whichever came last.
  if (value !== undefined && !table.fields.has(field)) {
    table.fields.set(field, value);
  }
}

/** Collects the `[package]` and `[workspace.package]` tables of one manifest. */
function collectPackageTables(source: string): { member: PackageTable; workspace: PackageTable } {
  const tables = { member: emptyTable(), workspace: emptyTable() };
  let current: PackageTable | undefined;
  let multiline: Multiline | undefined;

  for (const raw of source.split('\n')) {
    const insideString = multiline !== undefined;
    multiline = multilineOpenAfter(raw, multiline);

    const line = raw.trim();

    if (insideString || line === '' || line.startsWith('#')) {
      continue;
    }

    const header = readTableHeader(line);

    if (header === undefined) {
      if (current !== undefined) {
        readPackageField(line, current);
      }
      continue;
    }

    if (keyIs(header.key, 'package')) {
      current = tables.member;
    } else if (keyIs(header.key, 'workspace', 'package')) {
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
