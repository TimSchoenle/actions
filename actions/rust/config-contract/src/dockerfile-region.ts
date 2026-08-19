/**
 * The marked region of a Dockerfile, cut at its markers rather than by line count.
 *
 * This is the part every hand-written version of this check got wrong in a different way. `grep -A2`
 * and its relatives read correctly right up until a fourth label is added, and then compare two of
 * three lines and pass; a check keyed on `LABEL dev.terrace` stops seeing the block the moment the
 * prefix is renamed, which is exactly the change worth catching. The markers are the contract, so
 * the markers are what this cuts on.
 */

/** Opening marker, which `--format dockerfile` emits as the first line of its block. */
export const REGION_BEGIN = '# terrace-config:labels:begin';

/** Closing marker, emitted as the last line of the block. */
export const REGION_END = '# terrace-config:labels:end';

/** Why a Dockerfile yielded no region to compare. */
export type RegionProblem = 'missing' | 'unterminated' | 'repeated' | 'empty';

/** The region, or the reason there is not one. */
export type RegionOutcome =
  | { readonly kind: 'found'; readonly content: string }
  | { readonly kind: 'problem'; readonly problem: RegionProblem };

/**
 * What each problem means, in the terms the caller has to act in.
 *
 * Every one of these is refused rather than skipped. A Dockerfile with no region is not a Dockerfile
 * that passed — it is one where the generated block has nowhere to go, and treating that as "nothing
 * to compare" is how an image ships without the labels that make its contract discoverable.
 */
const PROBLEM_REASONS: Readonly<Record<RegionProblem, string>> = {
  missing: `carries no ${REGION_BEGIN} marker, so the generated LABEL block has nowhere to go and nothing to be compared against`,
  unterminated: `opens a ${REGION_BEGIN} region that is never closed by ${REGION_END}`,
  repeated: 'carries more than one marked region, so which of them publishes the contract is undecided',
  empty: 'has a marked region with nothing in it',
};

/** Renders a region problem as the sentence its annotation is built from. */
export function describeRegionProblem(problem: RegionProblem): string {
  return `${PROBLEM_REASONS[problem]}. Paste the output of \`--format dockerfile\`, markers included.`;
}

/** Whether a line is exactly a marker: no indentation, trailing whitespace only. */
function isMarker(line: string, marker: string): boolean {
  return line.trimEnd() === marker;
}

/**
 * Extracts the single marked region of a Dockerfile, markers included.
 *
 * The markers are part of the region because they are part of what `--format dockerfile` renders:
 * comparing the block without them would let the markers themselves be renamed or reordered without
 * anything noticing, and they are what the next run cuts on.
 */
export function extractLabelRegion(dockerfile: string): RegionOutcome {
  const lines = dockerfile.split(/\r?\n/);
  const starts: number[] = [];

  for (const [index, line] of lines.entries()) {
    if (isMarker(line, REGION_BEGIN)) {
      starts.push(index);
    }
  }

  if (starts.length === 0) {
    return { kind: 'problem', problem: 'missing' };
  }

  if (starts.length > 1) {
    return { kind: 'problem', problem: 'repeated' };
  }

  const begin = starts[0];
  const end = lines.findIndex((line, index) => index > begin && isMarker(line, REGION_END));

  if (end === -1) {
    return { kind: 'problem', problem: 'unterminated' };
  }

  if (lines.slice(begin + 1, end).every((line) => line.trim() === '')) {
    return { kind: 'problem', problem: 'empty' };
  }

  return { kind: 'found', content: `${lines.slice(begin, end + 1).join('\n')}\n` };
}
