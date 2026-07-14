import { readFile } from 'node:fs/promises';

import { Document, isAlias, isCollection, isScalar, parseDocument } from 'yaml';

import type { Scalar, YAMLMap, YAMLSeq } from 'yaml';

/**
 * The kinds of node a dot-path may legitimately land on. `Pair` and `Alias` are deliberately absent:
 * a path never addresses a pair, and an alias is resolved to its anchor before it reaches here.
 */
export type YamlValueNode = Scalar | YAMLMap | YAMLSeq;

/**
 * Narrow seam over the file system: resolves the file's contents, or `undefined` when the path is
 * not a readable file.
 *
 * Reading is the action's only I/O, so keeping it behind a single injectable function lets the whole
 * of `readYaml` be exercised without fixtures on disk, and avoids the TOCTOU gap an `exists()` +
 * `read()` pair would open.
 */
export type YamlFileReader = (filePath: string) => Promise<string | undefined>;

/**
 * The bash predecessor gated on `[ -f "$FILE" ]`, which is false both for a missing path and for a
 * directory. `readFile` reports those as ENOENT and EISDIR respectively; every other error (EACCES,
 * EMFILE, ...) is a genuine fault and must surface rather than be reported as "not found".
 */
const NOT_A_READABLE_FILE = new Set(['ENOENT', 'EISDIR']);

function isNotAReadableFile(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && typeof error.code === 'string' && NOT_A_READABLE_FILE.has(error.code)
  );
}

export const readYamlFile: YamlFileReader = async (filePath) => {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNotAReadableFile(error)) {
      return undefined;
    }
    throw error;
  }
};

/**
 * Renders a scalar exactly as it was authored, which is what `yq` printed and what callers compare
 * against in workflow expressions.
 *
 * The parser records the scalar's textual form in `source` (quotes stripped, escapes resolved), and
 * that is the only faithful representation available: the JS `value` has already been coerced by the
 * schema, so `1.0` would come back as `1`, `1e3` as `1000` and `007` as `7`. Version-like strings
 * such as `1.0.0` are never numbers to begin with and pass through untouched either way.
 *
 * A null value has no textual form when written as an empty value (`key:`), so it is normalised to
 * `null` — the same text `yq` printed, and the same text `modify-yaml` reports for a null old value.
 */
export function stringifyScalar(scalar: Scalar): string {
  if (scalar.value === null) {
    return 'null';
  }

  return scalar.source ?? String(scalar.value);
}

/**
 * Renders a map or sequence as a standalone YAML block, matching what `yq` printed for non-scalar
 * nodes. The bash predecessor could not actually deliver such a value — `echo "value=$VALUE" >>
 * "$GITHUB_OUTPUT"` corrupts the output file for anything multi-line — so this path is repaired, not
 * preserved: `core.setOutput` encodes multi-line values correctly.
 *
 * Comments and anchors held by nodes inside the subtree survive serialization; a comment written
 * above the key that addresses the subtree belongs to the parent's pair and does not. An anchor on
 * the root of the fragment is dropped: it exists only to be referenced from elsewhere in the source
 * document and would be meaningless noise in a value that stands alone. It is restored afterwards so
 * that the function has no observable effect on the document.
 */
export function stringifyCollection(collection: YAMLMap | YAMLSeq): string {
  const { anchor } = collection;
  collection.anchor = undefined;

  try {
    // YAML serialization always terminates the document with a newline; that is an artifact of the
    // encoding rather than part of the value.
    return new Document(collection).toString().replace(/\n$/, '');
  } finally {
    collection.anchor = anchor;
  }
}

export function stringifyValue(node: YamlValueNode): string {
  return isScalar(node) ? stringifyScalar(node) : stringifyCollection(node);
}

/**
 * Resolves a dot-path against the document, or `undefined` when it addresses nothing.
 *
 * Presence is decided structurally with `hasIn`, exactly as `modify-yaml` decides it, so that the
 * two halves of the contract agree: whatever `modify-yaml` can write at `a.b.c`, `read-yaml` reads
 * back from `a.b.c`. Traversing *through* a scalar therefore yields nothing rather than an error,
 * and a key that exists with an explicit `null` value counts as present.
 *
 * A terminal alias is followed to its anchor: emitting the literal `*ref` would be a reference to a
 * document the caller does not have. An alias that cannot be resolved is impossible here (the parser
 * reports an undefined anchor as an error), but is treated as absent for safety.
 */
function resolveNode(doc: Document, keys: readonly string[]): YamlValueNode | undefined {
  if (!doc.hasIn(keys)) {
    return undefined;
  }

  const node = doc.getIn(keys, true);
  const target = isAlias(node) ? node.resolve(doc) : node;

  return isScalar(target) || isCollection(target) ? target : undefined;
}

/**
 * Reads the value at `keyPath` from the YAML file at `filePath` and renders it as a string.
 *
 * Key paths are split on `.` — the same rule `modify-yaml` applies — so `app.database.host` walks
 * three levels, and a numeric segment indexes a sequence. Keys that themselves contain a dot are
 * consequently not addressable; that limitation is inherited from the `yq` invocation this replaces.
 */
export async function readYaml(
  filePath: string,
  keyPath: string,
  readSource: YamlFileReader = readYamlFile,
): Promise<string> {
  const source = await readSource(filePath);

  if (source === undefined) {
    throw new Error(`File not found: ${filePath}`);
  }

  const doc = parseDocument(source);

  if (doc.errors.length > 0) {
    throw new Error(`YAML parse error: ${doc.errors[0].message}`);
  }

  const node = resolveNode(doc, keyPath.split('.'));

  if (node === undefined) {
    throw new Error(`Key '${keyPath}' not found in ${filePath}`);
  }

  return stringifyValue(node);
}
