import { writeFile } from 'node:fs/promises';

import {
  applyYamlEdits,
  formatValue,
  inferValueType,
  loadYaml,
  splitKeyPath,
  YamlKeyNotFoundError,
} from 'actions-util/yaml';
import { parseDocument } from 'yaml';

/** The value at the key before and after the edit, both formatted by `formatValue`. */
export interface ModifyYamlResult {
  oldValue: string | undefined;
  /** Read back from the written text, so it reports what the file now holds, not what was asked for. */
  newValue: string;
}

/**
 * Replaces the value at `keyPath` in the YAML file at `filePath`, returning the value before and after.
 *
 * The file is edited surgically wherever possible: when the old value is a plain or quoted scalar,
 * the new value is spliced over its span in the original bytes, so comments, quoting style,
 * indentation and key order elsewhere in the file survive untouched. The spliced file is parsed again
 * and must mean exactly what `setIn` would have made of it; anything else, a map or block scalar
 * target or a multi-line value included, falls back to re-serializing the document.
 *
 * @throws {YamlFileNotFoundError} if the path is not a readable file — including a directory, which
 * the previous `existsSync` gate reported as present and then failed on with a raw `EISDIR`.
 * @throws {YamlParseError} if the file does not parse.
 * @throws {YamlKeyNotFoundError} if the key path addresses nothing.
 */
export async function modifyYaml(filePath: string, keyPath: string, newValue: string): Promise<ModifyYamlResult> {
  // `keepSourceTokens` keeps the node ranges the splice needs.
  const { document, source } = await loadYaml(filePath, { keepSourceTokens: true });

  const keys = splitKeyPath(keyPath);

  if (!document.hasIn(keys)) {
    throw new YamlKeyNotFoundError(keyPath, filePath);
  }

  const oldValue = formatValue(document.getIn(keys));

  const written = applyYamlEdits(source, document, [{ keys, value: inferValueType(newValue) }]);
  await writeFile(filePath, written, 'utf8');

  return { oldValue, newValue: formatValue(parseDocument(written, document.options).getIn(keys)) };
}
