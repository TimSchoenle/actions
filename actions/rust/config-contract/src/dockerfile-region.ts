/**
 * The marked regions of a Dockerfile, cut at their markers rather than by line count.
 *
 * This is the part every hand-written version of this check got wrong in a different way. `grep -A2`
 * and its relatives read correctly right up until a fourth label is added, and then compare two of
 * three lines and pass; a check keyed on `LABEL dev.terrace` stops seeing the block the moment the
 * prefix is renamed, which is exactly the change worth catching. The markers are the contract, so
 * the markers are what this cuts on.
 *
 * A Dockerfile may carry several regions, because a Dockerfile may build several images: a file with
 * three runtime stages carries three `LABEL` blocks, and each of them is a place the generated block
 * has to be correct. They are all cut and all compared — refusing the file for having more than one
 * would leave the only arrangement in which the check matters unable to use it at all.
 */

/** Opening marker, which `--format dockerfile` emits as the first line of its block. */
export const REGION_BEGIN = '# terrace-config:labels:begin';

/** Closing marker, emitted as the last line of the block. */
export const REGION_END = '# terrace-config:labels:end';

/**
 * Most regions one Dockerfile can plausibly carry.
 *
 * A stage per published image is the shape this exists for, and no repository has more stages than
 * this. Past it the file is generated, or hostile, and either way each region would become its own
 * annotation — so it is refused as a whole rather than answered with a flood.
 */
const MAX_REGIONS = 32;

/** Why a Dockerfile yielded no regions to compare. */
export type RegionProblem = 'excessive' | 'missing' | 'nested' | 'unterminated';

/** One marked region of a Dockerfile. */
export interface LabelRegion {
  /** The region including both markers, newline-terminated. */
  readonly content: string;
  /** 1-based line of the opening marker, so an annotation lands on the region that is wrong. */
  readonly line: number;
}

/** The regions, or the reason there are not any. */
export type RegionOutcome =
  | { readonly kind: 'found'; readonly regions: readonly LabelRegion[] }
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
  nested: `opens a ${REGION_BEGIN} region inside another, so where one region ends and the next begins is undecided`,
  excessive: `carries more than ${MAX_REGIONS} marked regions, which is past anything a Dockerfile builds`,
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
 * Extracts every marked region of a Dockerfile, markers included, in the order they appear.
 *
 * The markers are part of each region because they are part of what `--format dockerfile` renders:
 * comparing a block without them would let the markers themselves be renamed or reordered without
 * anything noticing, and they are what the next run cuts on.
 *
 * A closing marker with nothing open is ignored rather than reported. The opening marker is what
 * defines a region, so a file carrying only a stray `end` has no regions at all — which is exactly
 * what `missing` says, and is more use than a second name for the same fault.
 */
export function extractLabelRegions(dockerfile: string): RegionOutcome {
  const lines = dockerfile.split(/\r?\n/);
  const regions: LabelRegion[] = [];
  let begin: number | undefined;

  for (const [index, line] of lines.entries()) {
    if (isMarker(line, REGION_BEGIN)) {
      if (begin !== undefined) {
        return { kind: 'problem', problem: 'nested' };
      }

      begin = index;
    } else if (isMarker(line, REGION_END) && begin !== undefined) {
      regions.push({ content: `${lines.slice(begin, index + 1).join('\n')}\n`, line: begin + 1 });
      begin = undefined;
    }
  }

  if (begin !== undefined) {
    return { kind: 'problem', problem: 'unterminated' };
  }

  if (regions.length === 0) {
    return { kind: 'problem', problem: 'missing' };
  }

  return regions.length > MAX_REGIONS ? { kind: 'problem', problem: 'excessive' } : { kind: 'found', regions };
}

/** Whether a region holds nothing but its two markers, which is nothing to compare. */
export function isEmptyRegion(region: LabelRegion): boolean {
  return region.content
    .split('\n')
    .slice(1, -2)
    .every((line) => line.trim() === '');
}
