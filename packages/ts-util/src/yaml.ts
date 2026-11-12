import { isDeepStrictEqual } from 'node:util';

import { Document, isCollection, isScalar, parseDocument } from 'yaml';

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
  // The serializer renders negative zero as `0`, dropping the sign. `inferValueType` preserves it, so
  // without this a caller writing `-0` would silently get `0` back — the one number where JavaScript
  // distinguishes a value the YAML round-trip does not.
  if (Object.is(value, -0)) {
    return '-0';
  }

  // lineWidth 0 keeps a long string on one line. The default folds it at 80 columns with an indent
  // that is right for `dummyKey` and wrong wherever the text is spliced, which breaks the file.
  const tempDoc = new Document({ dummyKey: value });
  const tempString = tempDoc.toString({ lineWidth: 0 });

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

/** A value to write at a key path, as `Document.setIn` takes it. */
export interface YamlEdit {
  readonly keys: readonly unknown[];
  readonly value: string | number | boolean | null;
}

/** Scalar styles whose range covers exactly the value: no indicator, no trailing line break. */
const SPLICEABLE_TYPES: ReadonlySet<string> = new Set(['PLAIN', 'QUOTE_DOUBLE', 'QUOTE_SINGLE']);

interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Whether the node at `keys` sits inside a flow collection, where `,`, `]` and `}` end a plain scalar. */
function insideFlow(document: Document, keys: readonly unknown[]): boolean {
  for (let depth = 0; depth < keys.length; depth++) {
    const node = depth === 0 ? document.contents : document.getIn(keys.slice(0, depth), true);

    if (isCollection(node) && node.flow === true) {
      return true;
    }
  }

  return false;
}

/** The splice that writes `edit` over its node, or `undefined` when the node has no span to write over. */
function planSplice(document: Document, edit: YamlEdit): Splice | undefined {
  const node = document.getIn(edit.keys, true);

  if (!isScalar(node) || node.range == null || node.type === undefined || !SPLICEABLE_TYPES.has(node.type)) {
    return undefined;
  }

  // In a flow collection a string is written double-quoted: JSON's string syntax is valid YAML, and
  // a plain `v2,--privileged` would read back as two entries.
  const text =
    typeof edit.value === 'string' && insideFlow(document, edit.keys)
      ? JSON.stringify(edit.value)
      : generateYamlString(edit.value);

  if (text.includes('\n')) {
    return undefined;
  }

  const [start, end] = node.range;

  // An empty node (`tag:`) has an empty range right after the colon; without the space the value
  // would be glued to it and `tag:v2` would read as one plain scalar replacing the whole map.
  return start === end ? { start, end, text: ` ${text}` } : { start, end, text };
}

/**
 * The source with every edit applied, keeping comments, quoting and layout wherever it can.
 *
 * Each value is spliced over its node's span in the original text when the node is a plain or quoted
 * scalar. The result is then parsed again and has to parse cleanly and mean exactly what `setIn`
 * would have made of the document. When any node cannot be spliced, two spans overlap, or the check
 * fails, the edits are applied with `setIn` and the document is serialized instead, which loses some
 * formatting but never meaning.
 *
 * @param source - the text `document` was parsed from
 * @param document - the parsed source; it is not modified
 */
export function applyYamlEdits(source: string, document: Document, edits: readonly YamlEdit[]): string {
  const reference = document.clone();

  // A fresh node rather than the bare value: `setIn` with a bare value keeps the old node's style,
  // and a block scalar style cannot hold every value (a lone space serializes as an empty string).
  for (const edit of edits) {
    reference.setIn(edit.keys, reference.createNode(edit.value));
  }

  const fallback = (): string => reference.toString({ lineWidth: 0 });
  const splices: Splice[] = [];

  for (const edit of edits) {
    const splice = planSplice(document, edit);

    if (splice === undefined) {
      return fallback();
    }

    splices.push(splice);
  }

  splices.sort((a, b) => b.start - a.start);

  for (let index = 1; index < splices.length; index++) {
    if (splices[index].end > splices[index - 1].start) {
      return fallback();
    }
  }

  let content = source;

  for (const { start, end, text } of splices) {
    content = content.slice(0, start) + text + content.slice(end);
  }

  const reparsed = parseDocument(content, document.options);

  if (reparsed.errors.length > 0 || !isDeepStrictEqual(reparsed.toJS(), reference.toJS())) {
    return fallback();
  }

  return content;
}
