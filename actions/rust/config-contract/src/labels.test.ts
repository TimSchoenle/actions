import { describe, expect, it } from 'vitest';

import { LabelRenderingError } from './errors.js';
import { describeLabelFault, findLabelFaults, labelsAsJson, parseLabelLines, readImageLabels } from './labels.js';

const RENDERED = [
  'dev.terrace.config.contract.version=1',
  'dev.terrace.config.contract.path=/config/contract.json',
  'dev.terrace.config.contract.digest=sha256:abc',
].join('\n');

const EXPECTED = [
  { name: 'dev.terrace.config.contract.version', value: '1' },
  { name: 'dev.terrace.config.contract.path', value: '/config/contract.json' },
  { name: 'dev.terrace.config.contract.digest', value: 'sha256:abc' },
];

function imageLabels(overrides: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(EXPECTED.map((label) => [label.name, label.value]).concat(Object.entries(overrides)));
}

describe('parseLabelLines', () => {
  it('reads every rendered label', () => {
    expect(parseLabelLines(`${RENDERED}\n`)).toEqual(EXPECTED);
  });

  it('splits on the first separator only, so a value may contain one', () => {
    expect(parseLabelLines('a=b=c')).toEqual([{ name: 'a', value: 'b=c' }]);
  });

  it('accepts an empty value, which is a label with an empty value and not a missing one', () => {
    expect(parseLabelLines('a=')).toEqual([{ name: 'a', value: '' }]);
  });

  it('ignores blank lines, including a trailing newline', () => {
    expect(parseLabelLines('\na=1\n\n\nb=2\n')).toHaveLength(2);
  });

  it('reads a CRLF rendering the same way', () => {
    expect(parseLabelLines('a=1\r\nb=2\r\n')).toHaveLength(2);
  });

  // The shell spelling of this loop read a line without `=` as a name with a blank expectation,
  // which then matched any label whose value happened to be empty and quietly compared nothing.
  it('refuses a line that is not a label rather than reading it as an empty expectation', () => {
    expect(() => parseLabelLines('a=1\nnot-a-label\n')).toThrow(LabelRenderingError);
  });

  it('names the line it could not read', () => {
    expect(() => parseLabelLines('a=1\nnot-a-label\n')).toThrow(/line 2/);
  });

  it('refuses a line with an empty name', () => {
    expect(() => parseLabelLines('=1')).toThrow(LabelRenderingError);
  });

  it('refuses a repeated name, whose expected value would otherwise be undecided', () => {
    expect(() => parseLabelLines('a=1\na=2\n')).toThrow(/twice/);
  });

  // A rendering that came out blank would make the label comparison trivially true, which is the
  // one failure this whole scheme cannot afford.
  it.each(['', '\n', '   \n\n'])('refuses a rendering with no labels in it', (rendered) => {
    expect(() => parseLabelLines(rendered)).toThrow(/rendered no labels/);
  });
});

describe('readImageLabels', () => {
  it('reads an object of strings as itself', () => {
    expect(readImageLabels({ a: '1' })).toEqual({ a: '1' });
  });

  // Go marshals a nil `map[string]string` as `null`, so this is what an image with no labels at all
  // answers with. Refusing it would report "nothing was compared" for the case where there is most
  // obviously something to say.
  it('reads null as the empty set, so the comparison names what is missing', () => {
    expect(readImageLabels(null)).toEqual({});
    expect(findLabelFaults(EXPECTED, readImageLabels(null))).toHaveLength(3);
  });

  it('reads an empty object as the empty set too', () => {
    expect(readImageLabels({})).toEqual({});
  });

  it.each([
    { name: 'an array', value: [] },
    { name: 'a string', value: 'labels' },
    { name: 'a number', value: 4 },
    { name: 'a boolean', value: true },
  ])('refuses $name, which is not a label set at all', ({ value }) => {
    expect(() => readImageLabels(value)).toThrow(LabelRenderingError);
  });

  it('refuses a label whose value is not a string', () => {
    expect(() => readImageLabels({ a: 1 })).toThrow(/not a string/);
  });
});

describe('findLabelFaults', () => {
  it('reports nothing when every label is carried with the right value', () => {
    expect(findLabelFaults(EXPECTED, imageLabels())).toEqual([]);
  });

  // Every image carries `org.opencontainers.image.*` and whatever its base contributed, and none of
  // that is this document's business.
  it('ignores labels the contract does not publish', () => {
    expect(findLabelFaults(EXPECTED, imageLabels({ 'org.opencontainers.image.title': 'api' }))).toEqual([]);
  });

  it('reports an absent label', () => {
    const actual = imageLabels();
    delete actual['dev.terrace.config.contract.digest'];

    expect(findLabelFaults(EXPECTED, actual)).toEqual([{ kind: 'absent', name: 'dev.terrace.config.contract.digest' }]);
  });

  // A build argument that failed to interpolate is the case: the label is there, and its value is
  // the literal placeholder.
  it('reports a label whose value is not the one the contract publishes', () => {
    const faults = findLabelFaults(EXPECTED, imageLabels({ 'dev.terrace.config.contract.version': '${VERSION}' }));

    expect(faults).toEqual([
      {
        kind: 'mismatch',
        name: 'dev.terrace.config.contract.version',
        expected: '1',
        found: '${VERSION}',
      },
    ]);
  });

  // Presence and value are asked separately because they are different defects, and a single lookup
  // cannot tell them apart.
  it('separates an absent label from one whose value is empty', () => {
    const faults = findLabelFaults([{ name: 'a', value: '1' }], { a: '' });

    expect(faults).toEqual([{ kind: 'mismatch', name: 'a', expected: '1', found: '' }]);
  });

  // A build that names one missing label and hides two is a second round trip through a pipeline
  // that already took minutes.
  it('reports every fault, not the first', () => {
    expect(findLabelFaults(EXPECTED, {})).toHaveLength(3);
  });

  it('does not mistake a prototype member for a carried label', () => {
    expect(findLabelFaults([{ name: 'toString', value: 'x' }], {})).toEqual([{ kind: 'absent', name: 'toString' }]);
  });
});

describe('describeLabelFault', () => {
  it('says why an absent label matters, not merely that it is absent', () => {
    expect(describeLabelFault({ kind: 'absent', name: 'a' })).toContain('discover this contract');
  });

  it('quotes both values for a mismatch', () => {
    const described = describeLabelFault({ kind: 'mismatch', name: 'a', expected: '1', found: '2' });

    expect(described).toContain('`2`');
    expect(described).toContain('`1`');
  });
});

describe('labelsAsJson', () => {
  it('renders the set a push step would have to put on the image', () => {
    expect(JSON.parse(labelsAsJson(EXPECTED))).toEqual(imageLabels());
  });

  it('is a single line, so it survives being published as an output', () => {
    expect(labelsAsJson(EXPECTED)).not.toContain('\n');
  });
});
