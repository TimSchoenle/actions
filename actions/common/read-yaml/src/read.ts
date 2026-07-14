import { readFile } from 'node:fs/promises';

import { stringifyValue } from 'actions-common-ts-util';
import { isAlias, isCollection, isScalar, parseDocument } from 'yaml';

import type { YamlValueNode } from 'actions-common-ts-util';
import type { Document } from 'yaml';

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
