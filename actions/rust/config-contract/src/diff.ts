/**
 * The line-level comparison every drift check reports with.
 *
 * A check that says only "these differ" costs the caller a local rebuild before they know whether
 * they are looking at a renamed key or at a stray newline, so the report has to name the lines. It
 * is a log message and not a patch to apply, which is what licenses the two liberties taken here:
 * runs of unchanged lines are elided, and a comparison too large to align exactly degrades to the
 * first difference rather than to a slow step.
 */

/** Cells of the alignment table, past which the first difference is reported instead. */
const MAX_ALIGNMENT_CELLS = 2_000_000;

/** Unchanged lines kept either side of a change, so a hunk reads in context. */
const CONTEXT_LINES = 3;

/** Longest a single line is quoted before the rest is dropped. */
const MAX_LINE_LENGTH = 200;

/**
 * Most lines one difference is rendered as.
 *
 * The whole difference becomes a single annotation, and GitHub truncates a long one without saying
 * so — a report that is silently cut is worse than one that says how much it left out. Past this the
 * report is the first {@link MAX_DIFF_LINES} lines and a count, which is still enough to tell a
 * renamed key from a regenerated document.
 */
const MAX_DIFF_LINES = 60;

/** One aligned line, and which side it came from. */
export interface DiffOp {
  readonly kind: 'equal' | 'remove' | 'add';
  readonly line: string;
}

/**
 * Splits content into lines, treating a trailing newline as a terminator rather than a line.
 *
 * CRLF is folded to LF on both sides of every comparison this action makes. A checkout's line
 * endings are a property of the runner's git configuration and not of the contract, and a check that
 * failed on Windows and passed on Linux would be reporting the wrong thing entirely.
 */
export function toLines(content: string): string[] {
  const lines = content.split(/\r?\n/);

  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

function commonPrefixLength(a: readonly string[], b: readonly string[]): number {
  let index = 0;

  while (index < a.length && index < b.length && a[index] === b[index]) {
    index++;
  }

  return index;
}

function commonSuffixLength(a: readonly string[], b: readonly string[], limit: number): number {
  let index = 0;

  while (index < limit && a[a.length - 1 - index] === b[b.length - 1 - index]) {
    index++;
  }

  return index;
}

/**
 * The suffix-length table of the longest common subsequence, flattened into one typed array.
 *
 * `table[i * width + j]` is the length of the LCS of `left[i..]` and `right[j..]`, which is what
 * lets the walk below decide each step by comparing two neighbours rather than by searching.
 */
function alignmentTable(left: readonly string[], right: readonly string[], width: number): Int32Array {
  const table = new Int32Array((left.length + 1) * width);

  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i * width + j] =
        left[i] === right[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  return table;
}

/** Walks the table from both starts, emitting the operations that turn `left` into `right`. */
function walk(left: readonly string[], right: readonly string[], table: Int32Array, width: number): DiffOp[] {
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      ops.push({ kind: 'equal', line: left[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ kind: 'remove', line: left[i] });
      i++;
    } else {
      ops.push({ kind: 'add', line: right[j] });
      j++;
    }
  }

  for (; i < left.length; i++) {
    ops.push({ kind: 'remove', line: left[i] });
  }

  for (; j < right.length; j++) {
    ops.push({ kind: 'add', line: right[j] });
  }

  return ops;
}

/** Renders a run of lines neither side changed. */
function equalOps(lines: readonly string[]): DiffOp[] {
  return lines.map((line) => ({ kind: 'equal', line }) as const);
}

/**
 * Aligns two line sequences by longest common subsequence.
 *
 * The table is only ever built over the part that actually differs: identical head and tail are
 * matched off first, which for a drifted document is nearly all of it, and is what keeps a
 * thousand-line contract comparison well inside the cell budget.
 *
 * @returns the aligned operations, or `undefined` when the differing region is too large to align.
 */
export function alignLines(expected: readonly string[], actual: readonly string[]): DiffOp[] | undefined {
  const prefix = commonPrefixLength(expected, actual);
  const suffix = commonSuffixLength(expected, actual, Math.min(expected.length, actual.length) - prefix);
  const left = expected.slice(prefix, expected.length - suffix);
  const right = actual.slice(prefix, actual.length - suffix);

  if (left.length * right.length > MAX_ALIGNMENT_CELLS) {
    return undefined;
  }

  const width = right.length + 1;

  return [
    ...equalOps(expected.slice(0, prefix)),
    ...walk(left, right, alignmentTable(left, right, width), width),
    ...equalOps(expected.slice(expected.length - suffix)),
  ];
}

function quote(line: string): string {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line;
}

const MARKERS: Readonly<Record<DiffOp['kind'], string>> = { equal: ' ', remove: '-', add: '+' };

/** Indices of the unchanged lines worth keeping: those within {@link CONTEXT_LINES} of a change. */
function contextual(ops: readonly DiffOp[]): boolean[] {
  const keep = ops.map((op) => op.kind !== 'equal');

  for (const [index, op] of ops.entries()) {
    if (op.kind === 'equal') {
      continue;
    }

    for (let offset = 1; offset <= CONTEXT_LINES; offset++) {
      keep[Math.max(0, index - offset)] = true;
      keep[Math.min(ops.length - 1, index + offset)] = true;
    }
  }

  return keep;
}

/** Renders aligned operations, replacing long runs of unchanged lines — and a long tail — with a count. */
export function renderDiff(ops: readonly DiffOp[]): string {
  const keep = contextual(ops);
  const rendered: string[] = [];
  let elided = 0;

  const flush = (): void => {
    if (elided > 0) {
      rendered.push(`  … ${elided} unchanged line${elided === 1 ? '' : 's'} …`);
      elided = 0;
    }
  };

  for (const [index, op] of ops.entries()) {
    if (keep[index]) {
      flush();
      rendered.push(`${MARKERS[op.kind]} ${quote(op.line)}`);
    } else {
      elided++;
    }
  }

  flush();

  if (rendered.length <= MAX_DIFF_LINES) {
    return rendered.join('\n');
  }

  const dropped = rendered.length - MAX_DIFF_LINES;

  return [
    ...rendered.slice(0, MAX_DIFF_LINES),
    `  … ${dropped} further line${dropped === 1 ? '' : 's'} not shown …`,
  ].join('\n');
}

/** The fallback report for a comparison too large to align: where they first part ways. */
export function describeFirstDifference(expected: readonly string[], actual: readonly string[]): string {
  const at = commonPrefixLength(expected, actual);

  return [
    `Too large to align line by line. First difference on line ${at + 1}:`,
    `- ${quote(expected[at] ?? '<end of generated output>')}`,
    `+ ${quote(actual[at] ?? '<end of file>')}`,
  ].join('\n');
}

/**
 * Compares two documents line by line.
 *
 * @returns the rendered difference, or `undefined` when the two are identical.
 */
export function diffContent(expected: string, actual: string): string | undefined {
  const expectedLines = toLines(expected);
  const actualLines = toLines(actual);
  const ops = alignLines(expectedLines, actualLines);

  if (ops === undefined) {
    return describeFirstDifference(expectedLines, actualLines);
  }

  return ops.every((op) => op.kind === 'equal') ? undefined : renderDiff(ops);
}
