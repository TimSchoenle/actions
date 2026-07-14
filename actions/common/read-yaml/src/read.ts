import { loadYaml, readYamlFile, splitKeyPath, stringifyValue, YamlKeyNotFoundError } from 'actions-util';
import { isAlias, isCollection, isScalar } from 'yaml';

import type { YamlFileReader, YamlValueNode } from 'actions-util';
import type { Document } from 'yaml';

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
 * @throws {YamlFileNotFoundError} if the path is not a readable file.
 * @throws {YamlParseError} if the file does not parse.
 * @throws {YamlKeyNotFoundError} if the key path addresses nothing.
 */
export async function readYaml(
  filePath: string,
  keyPath: string,
  readSource: YamlFileReader = readYamlFile,
): Promise<string> {
  const { document } = await loadYaml(filePath, {}, readSource);

  const node = resolveNode(document, splitKeyPath(keyPath));

  if (node === undefined) {
    throw new YamlKeyNotFoundError(keyPath, filePath);
  }

  return stringifyValue(node);
}
