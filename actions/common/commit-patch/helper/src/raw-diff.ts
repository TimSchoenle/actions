/** One path the applied patch changed, as `git diff-index --raw -z --no-renames` reports it. */
export interface RawChange {
  /** Mode before the change, six octal digits; `000000` for an addition. */
  srcMode: string;
  /** Mode after the change; `000000` for a deletion. */
  dstMode: string;
  /** Blob before the change; all zeros for an addition. */
  srcSha: string;
  /** Blob after the change; all zeros for a deletion. */
  dstSha: string;
  /** Single status letter: `A`, `M`, `D`, or anything else git may emit, which the policy refuses. */
  status: string;
  /** Repository-relative path, exactly as git stores it. */
  path: string;
}

/** Raised when git's raw output does not have the shape this parser was written against. */
export class RawDiffFormatError extends Error {
  constructor(message: string) {
    super(`Unexpected git diff-index output: ${message}`);
    this.name = 'RawDiffFormatError';
  }
}

/**
 * The fixed part of one record: `:<srcmode> <dstmode> <srcsha> <dstsha> <status>`.
 *
 * The status may carry a similarity score (`R100`), which `--no-renames` rules out; the digits are
 * still accepted here so the policy, not the parser, is what refuses a rename.
 */
const HEADER = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([A-Z])(\d*)$/;

/**
 * Parses `git diff-index --raw -z --no-renames --no-abbrev` output into one record per path.
 *
 * With `-z` the header and the path are separate NUL-terminated fields, so a path containing a space,
 * tab or newline arrives intact and never needs unquoting. A copy or rename record carries two paths;
 * `--no-renames` means git never emits one, and this parser reads both and keeps the destination so
 * that an unexpected one still reaches the policy as a change it refuses rather than desynchronising
 * the fields that follow.
 *
 * @throws {RawDiffFormatError} when a header is malformed or a record is cut short.
 */
export function parseRawDiff(output: string): RawChange[] {
  const fields = output.split('\0');
  const changes: RawChange[] = [];

  // The output ends with a NUL, which leaves one empty field after the last record.
  if (fields.at(-1) === '') {
    fields.pop();
  }

  let index = 0;
  while (index < fields.length) {
    const header = fields[index];
    const match = HEADER.exec(header);

    if (!match) {
      throw new RawDiffFormatError(`malformed record header ${JSON.stringify(header)}`);
    }

    const [, srcMode, dstMode, srcSha, dstSha, status] = match;
    const pathCount = status === 'R' || status === 'C' ? 2 : 1;
    const paths = fields.slice(index + 1, index + 1 + pathCount);

    if (paths.length !== pathCount || paths.includes('')) {
      throw new RawDiffFormatError(`record ${JSON.stringify(header)} is missing its path`);
    }

    changes.push({ dstMode, dstSha, path: paths.at(-1) ?? '', srcMode, srcSha, status });
    index += 1 + pathCount;
  }

  return changes;
}
