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

import { applyYamlEdits, formatValue, loadYaml, splitKeyPath } from 'actions-util/yaml';
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
  /** The edits that change a value. An edit whose key already holds the same string is left out. */
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
  /** The value as parsed, to tell an edit that changes nothing from one that does. */
  readonly current: unknown;
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

    const current: unknown = document.getIn(keys);

    targets.push({ edit, keys, old: formatValue(current), current, range });
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
 * Fails when two keys reach overlapping source ranges, which two distinct dot-paths should never do.
 *
 * @throws {OverlappingEditsError} naming the two keys.
 */
function assertNoOverlap(targets: readonly ResolvedTarget[]): void {
  const ordered = targets
    .filter((target): target is ResolvedTarget & { range: readonly [number, number] } => target.range !== undefined)
    .sort((a, b) => b.range[0] - a.range[0]);

  for (let index = 1; index < ordered.length; index++) {
    const later = ordered[index - 1];
    const earlier = ordered[index];

    if (earlier.range[1] > later.range[0]) {
      throw new OverlappingEditsError(earlier.edit.key, later.edit.key);
    }
  }
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

  assertNoOverlap(targets);

  // A key that already holds the new value as a string is left out, so a re-run reports, and writes,
  // nothing for it. A number that reads the same is not equal: writing the string changes its type.
  const changing = targets.filter((target) => target.current !== target.edit.value);
  const applied = changing.map(({ edit, old }) => ({ key: edit.key, old, new: edit.value }));

  if (changing.length === 0) {
    return { filePath, content: source, applied };
  }

  // Splices every value into the original bytes when each target is a plain or quoted scalar and the
  // result means what `setIn` would; otherwise re-serializes the whole file, which keeps the meaning
  // but not every comment. Mixing the two would be incoherent, so one target demotes the whole file.
  const content = applyYamlEdits(
    source,
    document,
    changing.map(({ keys, edit }) => ({ keys, value: edit.value })),
  );

  return { filePath, content, applied };
}

/** Commits a plan to disk. Deliberately trivial: everything that can fail has already failed. */
export async function writeEditPlan(plan: EditPlan): Promise<void> {
  await writeFile(plan.filePath, plan.content, 'utf8');
}
