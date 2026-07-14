import { writeFile } from 'node:fs/promises';

import {
  formatValue,
  generateYamlString,
  inferValueType,
  loadYaml,
  splitKeyPath,
  YamlKeyNotFoundError,
} from 'actions-util';

/**
 * A node's span in the source. Typed structurally because the exact CST node types are awkward to
 * import, and the span is all this needs.
 */
interface NodeWithRange {
  range?: [number, number, number];
}

/**
 * Replaces the value at `keyPath` in the YAML file at `filePath`, returning the previous value.
 *
 * The file is edited surgically wherever possible: the new value is spliced over the old node's span
 * in the original bytes, so comments, quoting style, indentation and key order elsewhere in the file
 * survive untouched. Re-serializing the document would normalize all of that away. A multi-line value
 * has no single span to splice, so it falls back to re-serializing.
 *
 * @throws {YamlFileNotFoundError} if the path is not a readable file — including a directory, which
 * the previous `existsSync` gate reported as present and then failed on with a raw `EISDIR`.
 * @throws {YamlParseError} if the file does not parse.
 * @throws {YamlKeyNotFoundError} if the key path addresses nothing.
 */
export async function modifyYaml(filePath: string, keyPath: string, newValue: string): Promise<string | undefined> {
  // `keepSourceTokens` is what preserves the node ranges the surgical splice below needs.
  const { document, source } = await loadYaml(filePath, { keepSourceTokens: true });

  const keys = splitKeyPath(keyPath);

  if (!document.hasIn(keys)) {
    throw new YamlKeyNotFoundError(keyPath, filePath);
  }

  const oldValue = formatValue(document.getIn(keys));
  const valueToSet = inferValueType(newValue);
  const targetNode = document.getIn(keys, true) as NodeWithRange | undefined;

  if (targetNode?.range && !newValue.includes('\n')) {
    const [start, end] = targetNode.range;
    const spliced = source.slice(0, start) + generateYamlString(valueToSet) + source.slice(end);

    await writeFile(filePath, spliced, 'utf8');

    return oldValue;
  }

  document.setIn(keys, valueToSet);
  await writeFile(filePath, document.toString(), 'utf8');

  return oldValue;
}
