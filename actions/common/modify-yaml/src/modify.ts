import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';

import { formatValue, generateYamlString, inferValueType } from 'actions-util';
import { parseDocument } from 'yaml';

interface NodeWithRange {
  range?: [number, number, number];
}

export async function modifyYaml(filePath: string, keyPath: string, newValue: string): Promise<string | undefined> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileContent = await fs.readFile(filePath, 'utf-8');
  const doc = parseDocument(fileContent, { keepSourceTokens: true });

  if (doc.errors.length > 0) {
    throw new Error(`YAML parse error: ${doc.errors[0].message}`);
  }

  const keys = keyPath.split('.');
  const oldValue = doc.getIn(keys);

  if (oldValue === undefined && !doc.hasIn(keys)) {
    throw new Error(`Key '${keyPath}' not found in ${filePath}`);
  }

  const oldValueStr = formatValue(oldValue);
  const valueToSet = inferValueType(newValue);

  // Attempt surgical modification first (Strict Preservation)
  // We use NodeWithRange because exact CST Node types are complex to import perfectly.
  const targetNode = doc.getIn(keys, true) as NodeWithRange | undefined;

  // Only attempt surgical splice if:
  // 1. Node exists with range
  // 2. New value is NOT multiline (handling indentation manually is error-prone)
  // 3. New value doesn't look like it needs complex context awareness? (We rely on createNode)
  if (targetNode?.range && !String(newValue).includes('\n')) {
    const [start, end] = targetNode.range;
    const newString = generateYamlString(valueToSet);

    // Splice into original content
    const newFileContent = fileContent.slice(0, start) + newString + fileContent.slice(end);
    await fs.writeFile(filePath, newFileContent, 'utf-8');
    return oldValueStr;
  }

  // Fallback if range not found or complex value
  doc.setIn(keys, valueToSet);
  await fs.writeFile(filePath, doc.toString(), 'utf-8');

  return oldValueStr;
}
