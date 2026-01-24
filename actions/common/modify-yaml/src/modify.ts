import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';

import { Document, parseDocument } from 'yaml';

export function inferValueType(newValue: string): string | number | boolean | null {
  if (/^0x[\da-fA-F]+$/i.test(newValue)) {
    return Number(newValue);
  }
  if (/^-0x[\da-fA-F]+$/i.test(newValue)) {
    return -Number(newValue.substring(1));
  }
  if (/^0o[0-7]+$/.test(newValue)) {
    return Number(newValue);
  }
  if (/^-0o[0-7]+$/.test(newValue)) {
    return -Number(newValue.substring(1));
  }

  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(newValue)) {
    return Number(newValue);
  }
  if (newValue === '.inf') {
    return Infinity;
  }
  if (newValue === '-.inf') {
    return -Infinity;
  }
  if (newValue === '.nan') {
    return Number.NaN;
  }
  if (newValue === 'true') {
    return true;
  }
  if (newValue === 'false') {
    return false;
  }
  if (newValue === 'null') {
    return null;
  }
  return newValue;
}

// Helper to generate context-aware YAML string using a temporary document
export function generateYamlString(value: string | number | boolean | null): string {
  const tempDoc = new Document({ dummyKey: value });
  const tempString = tempDoc.toString();

  // Extract value part from "dummyKey: value\n"
  const separatorIndex = tempString.indexOf(': ');
  let newString: string;

  if (separatorIndex === -1) {
    newString = tempString.replace(/^dummyKey:\s*/, '');
  } else {
    newString = tempString.slice(separatorIndex + 2);
  }

  // Remove trailing newline
  if (newString.endsWith('\n')) {
    newString = newString.slice(0, -1);
  }

  // Handle special numeric values that YAML represents differently
  if (value === Infinity || value === -Infinity || Number.isNaN(value)) {
    return newString; // Return YAML's representation (.inf, -.inf, .nan)
  }

  // Handle string quoting edge case for empty strings if yaml library didn't quote them
  if (typeof value === 'string' && newString.trim().length === 0) {
    newString = `"${value}"`;
  }

  return newString;
}

// Helper to safely format value for reporting
export function formatValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value); // Fallback for circular refs etc
    }
  }
  return String(value);
}

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
