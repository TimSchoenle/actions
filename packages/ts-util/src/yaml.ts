import { Document, isScalar } from 'yaml';

import type { Scalar, YAMLMap, YAMLSeq } from 'yaml';

/**
 * The kinds of node a dot-path may legitimately land on. `Pair` and `Alias` are deliberately absent:
 * a path never addresses a pair, and an alias is resolved to its anchor before it reaches here.
 */
export type YamlValueNode = Scalar | YAMLMap | YAMLSeq;

/**
 * Renders a scalar exactly as it was authored, which is what `yq` printed and what callers compare
 * against in workflow expressions.
 */
export function stringifyScalar(scalar: Scalar): string {
  if (scalar.value === null) {
    return 'null';
  }

  return scalar.source ?? String(scalar.value);
}

/**
 * Renders a map or sequence as a standalone YAML block.
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

/**
 * Renders a YAML node (scalar or collection) as a string.
 */
export function stringifyValue(node: YamlValueNode): string {
  return isScalar(node) ? stringifyScalar(node) : stringifyCollection(node);
}

/**
 * Helper to safely format value for reporting.
 */
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

/**
 * Infers the type of a string value for YAML.
 */
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

  // eslint-disable-next-line security/detect-unsafe-regex
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(newValue)) {
    return Number(newValue);
  }
  if (newValue === 'Infinity' || newValue === '+Infinity' || newValue === '.inf') {
    return Infinity;
  }
  if (newValue === '-Infinity' || newValue === '-.inf') {
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

/**
 * Helper to generate context-aware YAML string using a temporary document.
 */
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
  if (value === Infinity || value === -Infinity || (typeof value === 'number' && Number.isNaN(value))) {
    return newString; // Return YAML's representation (.inf, -.inf, .nan)
  }

  // Handle string quoting edge case for empty strings if yaml library didn't quote them
  if (typeof value === 'string' && newString.trim().length === 0) {
    newString = `"${value}"`;
  }

  return newString;
}
