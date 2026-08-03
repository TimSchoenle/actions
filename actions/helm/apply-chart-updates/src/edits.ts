/**
 * Multi-key YAML editing that preserves the file byte-for-byte outside the values it changes.
 *
 * `common/modify-yaml` writes one key by splicing that node's source range back into the original
 * text, which is what keeps a chart's `# @schema` blocks and doc comments intact. This is the same
 * technique for N keys at once, which a composite action cannot express: composite steps cannot
 * loop, so "update ten images" is either a shell loop over `yq` or a single process. This is the
 * single process.
 *
 * Planning and writing are separate so that *every* file can be validated before *any* file is
 * written. One bad entry must leave the checkout untouched, not half-updated.
 */
import { writeFile } from 'node:fs/promises';

import { formatValue, generateYamlString, loadYaml, splitKeyPath } from 'actions-util';
import { isScalar } from 'yaml';

import type { Document } from 'yaml';

/** A value to write at a dot-path. */
export interface PlannedEdit {
  readonly key: string;
  readonly value: string;
}

/** What an edit turned out to change, for reporting. */
export interface AppliedEdit {
  readonly key: string;
  readonly old: string;
  readonly new: string;
}

/** A fully resolved rewrite of one file: nothing left to validate, only bytes left to write. */
export interface EditPlan {
  readonly filePath: string;
  readonly content: string;
  readonly applied: readonly AppliedEdit[];
}

/** Raised when a key does not already exist in the document. */
export class MissingKeysError extends Error {
  constructor(
    readonly keys: readonly string[],
    readonly filePath: string,
  ) {
    super(`Key${keys.length === 1 ? '' : 's'} not found in ${filePath}: ${keys.join(', ')}`);
    this.name = 'MissingKeysError';
  }
}

/** Raised when a key addresses a map, a sequence or an alias rather than a value. */
export class NonScalarTargetError extends Error {
  constructor(
    readonly keys: readonly string[],
    readonly filePath: string,
  ) {
    super(`Key${keys.length === 1 ? '' : 's'} in ${filePath} do not address a scalar value: ${keys.join(', ')}`);
    this.name = 'NonScalarTargetError';
  }
}

/** Raised when two keys resolve to overlapping source ranges. */
export class OverlappingEditsError extends Error {
  constructor(
    readonly first: string,
    readonly second: string,
  ) {
    super(`Keys '${first}' and '${second}' address the same value`);
    this.name = 'OverlappingEditsError';
  }
}

interface ResolvedTarget {
  readonly edit: PlannedEdit;
  readonly keys: readonly string[];
  readonly old: string;
  /** Source range of the scalar token, absent for a node the parser did not attribute one to. */
  readonly range: readonly [number, number] | undefined;
}

/**
 * Resolves every edit against the document, failing on the *whole set* rather than the first
 * problem. A caller updating ten images wants one error listing every key that is wrong, not ten
 * successive runs each revealing the next one.
 */
function resolveTargets(document: Document, edits: readonly PlannedEdit[], filePath: string): ResolvedTarget[] {
  const missing: string[] = [];
  const nonScalar: string[] = [];
  const targets: ResolvedTarget[] = [];

  for (const edit of edits) {
    const keys = splitKeyPath(edit.key);

    if (!document.hasIn(keys)) {
      missing.push(edit.key);
      continue;
    }

    const node = document.getIn(keys, true);

    // Aliases land here too, and deliberately so: splicing over `*anchor` would replace a reference
    // with a literal and silently detach the value from its anchor.
    if (!isScalar(node)) {
      nonScalar.push(edit.key);
      continue;
    }

    // `range` is nullable, not merely optional: the parser leaves it null for a node it constructed
    // rather than read, which is exactly the case the re-serialization fallback exists for.
    const range = node.range == null ? undefined : ([node.range[0], node.range[1]] as const);

    targets.push({ edit, keys, old: formatValue(document.getIn(keys)), range });
  }

  if (missing.length > 0) {
    throw new MissingKeysError(missing, filePath);
  }

  if (nonScalar.length > 0) {
    throw new NonScalarTargetError(nonScalar, filePath);
  }

  return targets;
}

/**
 * Splices every new value into the original source, highest offset first so the offsets still ahead
 * stay valid.
 *
 * @throws {OverlappingEditsError} when two keys reach the same token — which two distinct dot-paths
 * should never do, and which would otherwise corrupt the file.
 */
function spliceAll(
  source: string,
  targets: readonly (ResolvedTarget & { range: readonly [number, number] })[],
): string {
  const ordered = [...targets].sort((a, b) => b.range[0] - a.range[0]);

  for (let index = 1; index < ordered.length; index++) {
    const later = ordered[index - 1];
    const earlier = ordered[index];

    if (earlier.range[1] > later.range[0]) {
      throw new OverlappingEditsError(earlier.edit.key, later.edit.key);
    }
  }

  let content = source;

  for (const target of ordered) {
    const [start, end] = target.range;
    content = content.slice(0, start) + generateYamlString(target.edit.value) + content.slice(end);
  }

  return content;
}

/** Re-serializes the whole document. Loses nothing semantically, but does not preserve every comment. */
function reserializeAll(document: Document, targets: readonly ResolvedTarget[]): string {
  for (const target of targets) {
    document.setIn(target.keys, target.edit.value);
  }

  return document.toString();
}

/**
 * Reads `filePath` and produces the exact content it should be replaced with.
 *
 * Values are always written as strings. Helm image tags and chart versions are strings, and inferring
 * a type from the text would turn a tag of `18` into the number `18` — a different value to Helm and
 * a different one to anything reading the chart back.
 *
 * @throws {MissingKeysError} when a key does not already exist. The action never creates a path: a
 * caller can rewrite an image tag, not invent a configuration key.
 */
export async function planYamlEdits(filePath: string, edits: readonly PlannedEdit[]): Promise<EditPlan> {
  // `keepSourceTokens` is what gives the nodes the ranges the splice needs.
  const { document, source } = await loadYaml(filePath, { keepSourceTokens: true });

  const targets = resolveTargets(document, edits, filePath);

  const applied = targets.map(({ edit, old }) => ({ key: edit.key, old, new: edit.value }));

  // Mixing the two strategies would be incoherent — a splice works on the original bytes and a
  // `setIn` on the parsed tree — so an unattributed node demotes the whole file to re-serialization.
  const hasRange = (target: ResolvedTarget): target is ResolvedTarget & { range: readonly [number, number] } =>
    target.range !== undefined;

  const content = targets.every(hasRange) ? spliceAll(source, targets) : reserializeAll(document, targets);

  return { filePath, content, applied };
}

/** Commits a plan to disk. Deliberately trivial: everything that can fail has already failed. */
export async function writeEditPlan(plan: EditPlan): Promise<void> {
  await writeFile(plan.filePath, plan.content, 'utf8');
}
