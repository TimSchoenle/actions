import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import { applyYamlEdits, generateYamlString, inferValueType } from './yaml.js';

import type { YamlEdit } from './yaml.js';

/** Applies `edits` to `source` and returns the new text. */
function apply(source: string, edits: readonly YamlEdit[]): string {
  return applyYamlEdits(source, parseDocument(source, { keepSourceTokens: true }), edits);
}

/** What the file means after `setIn`, which every result has to agree with. */
function expected(source: string, edits: readonly YamlEdit[]): unknown {
  const document = parseDocument(source);
  for (const edit of edits) {
    document.setIn(edit.keys, edit.value);
  }

  return document.toJS();
}

function parsed(text: string): unknown {
  const document = parseDocument(text);
  expect(document.errors).toEqual([]);

  return document.toJS();
}

const LONG = Array.from({ length: 30 }, (_, index) => `word${index}`).join(' ');

// K1: a tag such as 1.10 was written as the number 1.1, so the image that deployed was not the one named.
describe('inferValueType', () => {
  it.each(['1.10', '0123', '1.0', '12e4567', '1e10', '9007199254740993', '0xFF', '0o777', '-0', '+1', '.5', '1.'])(
    'keeps %j as the string it is, because no number writes back as that text',
    (value) => {
      expect(inferValueType(value)).toBe(value);
    },
  );

  it.each([
    ['123', 123],
    ['-10', -10],
    ['0', 0],
    ['12.34', 12.34],
    ['-0.5', -0.5],
    ['9007199254740991', 9_007_199_254_740_991],
  ])('infers %j as a number, because it writes back unchanged', (value, number) => {
    expect(inferValueType(value)).toBe(number);
  });

  it('round-trips every inferred number through its own text', () => {
    fc.assert(
      fc.property(fc.oneof(fc.stringMatching(/^-?\d{1,20}(\.\d{1,20})?([Ee][+-]?\d{1,4})?$/), fc.string()), (value) => {
        const inferred = inferValueType(value);

        if (typeof inferred === 'number' && Number.isFinite(inferred)) {
          expect(String(inferred)).toBe(value);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('generateYamlString', () => {
  it('never folds a long string onto a second line', () => {
    expect(generateYamlString(LONG)).not.toContain('\n');
  });
});

describe('applyYamlEdits', () => {
  it('splices a plain scalar and keeps everything else byte for byte', () => {
    const source = '# header\nimage:\n  tag: v1 # pinned\n  repo: x\n';

    expect(apply(source, [{ keys: ['image', 'tag'], value: 'v2' }])).toBe(
      '# header\nimage:\n  tag: v2 # pinned\n  repo: x\n',
    );
  });

  it('keeps a long value at a nested key on one line, under its key', () => {
    const source = 'outer:\n  inner:\n    value: short\n  sibling: 1\n';
    const edits = [{ keys: ['outer', 'inner', 'value'], value: LONG }];

    const result = apply(source, edits);

    expect(parsed(result)).toEqual(expected(source, edits));
    expect(result).toContain('  sibling: 1\n');
  });

  it('writes a value into an empty node instead of gluing it to the colon', () => {
    const source = 'image:\n  tag:\n  repo: x\n';
    const edits = [{ keys: ['image', 'tag'], value: 'v2' }];

    const result = apply(source, edits);

    expect(result).toBe('image:\n  tag: v2\n  repo: x\n');
    expect(parsed(result)).toEqual(expected(source, edits));
  });

  it('does not let a value swallow the comment after it', () => {
    const source = 'tag: v1 # keep me\n';
    const edits = [{ keys: ['tag'], value: 'v2 #not-a-comment' }];

    const result = apply(source, edits);

    expect(parsed(result)).toEqual(expected(source, edits));
    expect(result).toContain('# keep me');
  });

  it('keeps the line after a block scalar it replaces', () => {
    const source = 'script: |\n  echo one\nnext: 2\n';
    const edits = [{ keys: ['script'], value: 'two' }];

    expect(parsed(apply(source, edits))).toEqual(expected(source, edits));
  });

  it('quotes a value with a comma inside a flow sequence, so it stays one entry', () => {
    const source = 'args: [v1, --safe]\n';
    const edits = [{ keys: ['args', 0], value: 'v2,--privileged' }];

    const result = apply(source, edits);

    expect(parsed(result)).toEqual({ args: ['v2,--privileged', '--safe'] });
  });

  it('quotes a value with a closing brace inside a flow map', () => {
    const source = 'image: { tag: v1, repo: x }\n';
    const edits = [{ keys: ['image', 'tag'], value: 'v2}, evil: true' }];

    expect(parsed(apply(source, edits))).toEqual(expected(source, edits));
  });

  it('replaces a map target without taking the next top-level key with it', () => {
    const source = 'map:\n  k: v\nnext: 2\n';
    const edits = [{ keys: ['map'], value: 'scalar' }];

    const result = apply(source, edits);

    expect(parsed(result)).toEqual({ map: 'scalar', next: 2 });
  });

  it('applies several edits, highest offset first', () => {
    const source = 'a: 1\nb:\n  c: 2\nd: [3, 4]\n';
    const edits = [
      { keys: ['a'], value: 'one' },
      { keys: ['b', 'c'], value: LONG },
      { keys: ['d', 1], value: 'x, y' },
    ];

    expect(parsed(apply(source, edits))).toEqual(expected(source, edits));
  });

  // The property behind every case above: whatever the splice writes must mean what setIn means.
  it('always agrees with setIn', () => {
    const scalar = fc.oneof(
      fc.string({ maxLength: 120 }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.constantFrom('', ' ', '#', '- x', 'a: b', 'x, y', '[', ']', '{', '}', '|', '>', '"', "'", '\t', LONG),
    );
    const layout = fc.constantFrom(
      'root:\n  key: old\n  after: 1\n',
      'root:\n  key:\n  after: 1\n',
      'root:\n  key: "old" # c\n  after: 1\n',
      "root:\n  key: 'old'\n  after: 1\n",
      'root:\n  key: |\n    old\n  after: 1\n',
      'root:\n  key: >-\n    old\n  after: 1\n',
      'root: { key: old, after: 1 }\n',
      'root:\n  key:\n    nested: map\n  after: 1\n',
      'root:\n  key: [old, older]\n  after: 1\n',
    );

    fc.assert(
      fc.property(layout, scalar, (source, value) => {
        const edits = [{ keys: ['root', 'key'], value }];

        expect(parsed(apply(source, edits))).toEqual(expected(source, edits));
      }),
      { numRuns: 500 },
    );
  });
});
