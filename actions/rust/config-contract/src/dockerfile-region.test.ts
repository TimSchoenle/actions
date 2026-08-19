import { describe, expect, it } from 'vitest';

import { describeRegionProblem, extractLabelRegion, REGION_BEGIN, REGION_END } from './dockerfile-region.js';

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

describe('extractLabelRegion', () => {
  it('returns the region including both markers', () => {
    const outcome = extractLabelRegion(dockerfile(BLOCK));

    expect(outcome).toEqual({ kind: 'found', content: `${BLOCK}\n` });
  });

  // The markers are part of what `--format dockerfile` renders. Comparing the block without them
  // would let the markers themselves be renamed without anything noticing, and they are what the
  // next run cuts on.
  it('keeps the markers inside the region, so renaming one is a difference', () => {
    const outcome = extractLabelRegion(dockerfile(BLOCK));

    expect(outcome.kind === 'found' && outcome.content.startsWith(REGION_BEGIN)).toBe(true);
    expect(outcome.kind === 'found' && outcome.content.trimEnd().endsWith(REGION_END)).toBe(true);
  });

  it('cuts at the markers, so a fourth label is inside the region rather than past it', () => {
    const wider = BLOCK.replace(REGION_END, `LABEL dev.terrace.config.contract.schema="2"\n${REGION_END}`);
    const outcome = extractLabelRegion(dockerfile(wider));

    expect(outcome).toEqual({ kind: 'found', content: `${wider}\n` });
  });

  it('ignores lines outside the region, however label-shaped they are', () => {
    const outcome = extractLabelRegion(
      dockerfile('LABEL dev.terrace.config.contract.version="9"', BLOCK, 'LABEL org.opencontainers.image.title="api"'),
    );

    expect(outcome).toEqual({ kind: 'found', content: `${BLOCK}\n` });
  });

  it('reads a CRLF checkout as the same region', () => {
    const outcome = extractLabelRegion(dockerfile(BLOCK).replaceAll('\n', '\r\n'));

    expect(outcome).toEqual({ kind: 'found', content: `${BLOCK}\n` });
  });

  it.each([
    { name: 'no marker at all', content: dockerfile('LABEL a=1'), problem: 'missing' },
    { name: 'an empty file', content: '', problem: 'missing' },
    {
      name: 'an opening marker that is never closed',
      content: dockerfile(REGION_BEGIN, 'LABEL a=1'),
      problem: 'unterminated',
    },
    { name: 'two regions', content: dockerfile(BLOCK, BLOCK), problem: 'repeated' },
    { name: 'a region with nothing in it', content: dockerfile(REGION_BEGIN, REGION_END), problem: 'empty' },
    {
      name: 'a region holding only blank lines',
      content: dockerfile(REGION_BEGIN, '', '   ', REGION_END),
      problem: 'empty',
    },
  ])('reports $name as $problem', ({ content, problem }) => {
    expect(extractLabelRegion(content)).toEqual({ kind: 'problem', problem });
  });

  it('does not accept an indented marker, which is a line inside a heredoc rather than a marker', () => {
    expect(extractLabelRegion(dockerfile(`  ${REGION_BEGIN}`, 'LABEL a=1', `  ${REGION_END}`))).toEqual({
      kind: 'problem',
      problem: 'missing',
    });
  });

  it('tolerates trailing whitespace on a marker, which an editor adds and a reviewer cannot see', () => {
    expect(extractLabelRegion(dockerfile(`${REGION_BEGIN}  `, 'LABEL a=1', `${REGION_END}\t`)).kind).toBe('found');
  });

  it('reports a closing marker that precedes the opening one as unterminated', () => {
    expect(extractLabelRegion(dockerfile(REGION_END, 'LABEL a=1', REGION_BEGIN))).toEqual({
      kind: 'problem',
      problem: 'unterminated',
    });
  });
});

describe('describeRegionProblem', () => {
  it.each(['missing', 'unterminated', 'repeated', 'empty'] as const)(
    'explains %s and what to do about it',
    (problem) => {
      const described = describeRegionProblem(problem);

      expect(described).toMatch(/\S/);
      expect(described).toContain('--format dockerfile');
    },
  );
});
