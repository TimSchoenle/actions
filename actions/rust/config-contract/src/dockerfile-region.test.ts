import { describe, expect, it } from 'vitest';

import {
  describeRegionProblem,
  extractLabelRegions,
  isEmptyRegion,
  REGION_BEGIN,
  REGION_END,
} from './dockerfile-region.js';

import type { LabelRegion } from './dockerfile-region.js';

const BLOCK = [
  REGION_BEGIN,
  'LABEL dev.terrace.config.contract.version="1"',
  'LABEL dev.terrace.config.contract.path="/config/contract.json"',
  'LABEL dev.terrace.config.contract.digest="sha256:abc"',
  REGION_END,
].join('\n');

function dockerfile(...parts: string[]): string {
  return ['FROM rust:1 AS build', 'RUN cargo build --release', ...parts, 'ENTRYPOINT ["/app"]', ''].join('\n');
}

/** The regions of a Dockerfile, or a failure naming the problem that was reported instead. */
function regionsOf(content: string): readonly LabelRegion[] {
  const outcome = extractLabelRegions(content);

  if (outcome.kind === 'problem') {
    throw new Error(`expected regions, got the problem '${outcome.problem}'`);
  }

  return outcome.regions;
}

describe('extractLabelRegions', () => {
  it('returns the region including both markers', () => {
    expect(regionsOf(dockerfile(BLOCK))).toEqual([{ content: `${BLOCK}\n`, line: 3 }]);
  });

  // The markers are part of what `--format dockerfile` renders. Comparing the block without them
  // would let the markers themselves be renamed without anything noticing, and they are what the
  // next run cuts on.
  it('keeps the markers inside the region, so renaming one is a difference', () => {
    const [region] = regionsOf(dockerfile(BLOCK));

    expect(region.content.startsWith(REGION_BEGIN)).toBe(true);
    expect(region.content.trimEnd().endsWith(REGION_END)).toBe(true);
  });

  it('cuts at the markers, so a fourth label is inside the region rather than past it', () => {
    const wider = BLOCK.replace(REGION_END, `LABEL dev.terrace.config.contract.schema="2"\n${REGION_END}`);

    expect(regionsOf(dockerfile(wider))[0].content).toBe(`${wider}\n`);
  });

  it('ignores lines outside the region, however label-shaped they are', () => {
    const regions = regionsOf(
      dockerfile('LABEL dev.terrace.config.contract.version="9"', BLOCK, 'LABEL org.opencontainers.image.title="api"'),
    );

    expect(regions.map((region) => region.content)).toEqual([`${BLOCK}\n`]);
  });

  it('reads a CRLF checkout as the same region', () => {
    expect(regionsOf(dockerfile(BLOCK).replaceAll('\n', '\r\n'))[0].content).toBe(`${BLOCK}\n`);
  });

  // A Dockerfile may build several images, and a file with three runtime stages carries three LABEL
  // blocks. Refusing it for having more than one leaves the arrangement this check matters most in
  // unable to use the check at all.
  describe('a Dockerfile with several marked regions', () => {
    it('returns every region, in the order they appear', () => {
      const regions = regionsOf(dockerfile(BLOCK, 'FROM scratch AS worker', BLOCK));

      expect(regions).toHaveLength(2);
      expect(regions.every((region) => region.content === `${BLOCK}\n`)).toBe(true);
    });

    it('returns them even when they differ, so each can be reported on its own', () => {
      const other = BLOCK.replace('sha256:abc', 'sha256:def');
      const regions = regionsOf(dockerfile(BLOCK, other));

      expect(regions.map((region) => region.content)).toEqual([`${BLOCK}\n`, `${other}\n`]);
    });

    // Which of three stages is wrong is the first thing a reviewer needs, and a message that says
    // only "the region" leaves them to work it out.
    it('anchors each region to the line its opening marker is on', () => {
      const regions = regionsOf(dockerfile(BLOCK, 'FROM scratch AS worker', BLOCK));
      const lines = dockerfile(BLOCK, 'FROM scratch AS worker', BLOCK).split('\n');

      expect(regions.map((region) => region.line)).toEqual([3, 9]);
      expect(regions.every((region) => lines[region.line - 1] === REGION_BEGIN)).toBe(true);
    });
  });

  it.each([
    { name: 'no marker at all', content: dockerfile('LABEL a=1'), problem: 'missing' },
    { name: 'an empty file', content: '', problem: 'missing' },
    {
      name: 'an opening marker that is never closed',
      content: dockerfile(REGION_BEGIN, 'LABEL a=1'),
      problem: 'unterminated',
    },
    {
      name: 'a region opened inside another',
      content: dockerfile(REGION_BEGIN, 'LABEL a=1', REGION_BEGIN, 'LABEL b=2', REGION_END),
      problem: 'nested',
    },
    {
      name: 'more regions than a Dockerfile builds',
      content: dockerfile(...Array.from({ length: 33 }, () => BLOCK)),
      problem: 'excessive',
    },
  ])('reports $name as $problem', ({ content, problem }) => {
    expect(extractLabelRegions(content)).toEqual({ kind: 'problem', problem });
  });

  it('accepts a file holding exactly as many regions as the limit allows', () => {
    expect(regionsOf(dockerfile(...Array.from({ length: 32 }, () => BLOCK)))).toHaveLength(32);
  });

  it('does not accept an indented marker, which is a line inside a heredoc rather than a marker', () => {
    expect(extractLabelRegions(dockerfile(`  ${REGION_BEGIN}`, 'LABEL a=1', `  ${REGION_END}`))).toEqual({
      kind: 'problem',
      problem: 'missing',
    });
  });

  it('tolerates trailing whitespace on a marker, which an editor adds and a reviewer cannot see', () => {
    expect(extractLabelRegions(dockerfile(`${REGION_BEGIN}  `, 'LABEL a=1', `${REGION_END}\t`)).kind).toBe('found');
  });

  // The opening marker is what defines a region, so a file carrying only a stray closing one has no
  // regions at all — which is exactly what `missing` says.
  it('ignores a closing marker with nothing open', () => {
    expect(extractLabelRegions(dockerfile(REGION_END, 'LABEL a=1'))).toEqual({ kind: 'problem', problem: 'missing' });
  });

  it('reports a closing marker that precedes the opening one as unterminated', () => {
    expect(extractLabelRegions(dockerfile(REGION_END, 'LABEL a=1', REGION_BEGIN))).toEqual({
      kind: 'problem',
      problem: 'unterminated',
    });
  });

  it('cuts a region that follows a stray closing marker', () => {
    expect(regionsOf(dockerfile(REGION_END, BLOCK))[0].content).toBe(`${BLOCK}\n`);
  });
});

describe('isEmptyRegion', () => {
  it.each([
    { name: 'holding nothing at all', content: `${REGION_BEGIN}\n${REGION_END}\n` },
    { name: 'holding only blank lines', content: `${REGION_BEGIN}\n\n   \n\t\n${REGION_END}\n` },
  ])('reports a region $name as empty', ({ content }) => {
    expect(isEmptyRegion({ content, line: 1 })).toBe(true);
  });

  it('reports a region with a label in it as not empty', () => {
    expect(isEmptyRegion({ content: `${BLOCK}\n`, line: 1 })).toBe(false);
  });

  it('agrees with what the cutter produced for an empty region', () => {
    const [region] = regionsOf(`FROM scratch\n${REGION_BEGIN}\n${REGION_END}\n`);

    expect(isEmptyRegion(region)).toBe(true);
  });
});

describe('describeRegionProblem', () => {
  it.each(['missing', 'unterminated', 'nested', 'excessive'] as const)(
    'explains %s and what to do about it',
    (problem) => {
      const described = describeRegionProblem(problem);

      expect(described).toMatch(/\S/);
      expect(described).toContain('--format dockerfile');
    },
  );
});
