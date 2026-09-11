import { describe, expect, it } from 'vitest';

import { composeBody, hasMarker, InvalidIdentifierError, markerFor, MAX_ISSUE_BODY_LENGTH } from './marker.js';

/** Written by code point, so this file itself holds no line-breaking character. */
const LINE_SEPARATOR = String.fromCodePoint(0x20_28);

describe('markerFor', () => {
  it('builds a namespaced HTML comment', () => {
    expect(markerFor('repo-state')).toBe('<!-- timschoenle/actions:issue:repo-state -->');
  });

  it.each(['a', 'A1', '1', 'a_b', 'a.b', 'a-b', 'x'.repeat(64)])('accepts the identifier %j', (identifier) => {
    expect(() => markerFor(identifier)).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['a closing delimiter', 'size --><script>'],
    ['a newline', 'size\nother'],
    ['a carriage return', 'size\rother'],
    ['a space', 'issue size'],
    ['a leading hyphen', '-size'],
    ['a slash', 'owner/size'],
    ['a colon', 'ns:size'],
    ['a non-ASCII letter', 'größe'],
    ['a line separator', `size${LINE_SEPARATOR}other`],
    ['65 characters', 'x'.repeat(65)],
  ])('rejects an identifier carrying %s', (_name, identifier) => {
    expect(() => markerFor(identifier)).toThrow(InvalidIdentifierError);
  });

  it('names the offending value in the message, quoted', () => {
    expect(() => markerFor('a b')).toThrow('"a b"');
  });

  // The message becomes an `::error::` annotation, so a character JSON leaves literal reaches the
  // step log intact. `quoteForLog` is what escapes the ones above U+001F that JSON does not.
  it('escapes a character the log would otherwise render, rather than passing it through', () => {
    expect(() => markerFor(`size${LINE_SEPARATOR}other`)).toThrow(String.raw`"size\u2028other"`);
  });
});

describe('hasMarker', () => {
  const marker = markerFor('size');

  it('finds the marker on the first line', () => {
    expect(hasMarker(`${marker}\n\nbody`, marker)).toBe(true);
  });

  it('finds a marker a later edit pushed down the body', () => {
    expect(hasMarker(`intro\n${marker}\nbody`, marker)).toBe(true);
  });

  it('tolerates trailing whitespace on the marker line', () => {
    expect(hasMarker(`${marker}  \n\nbody`, marker)).toBe(true);
  });

  it('does not match a marker embedded in a line of prose', () => {
    expect(hasMarker(`see ${marker} for details`, marker)).toBe(false);
  });

  it('does not match a different identifier', () => {
    expect(hasMarker(`${markerFor('other')}\n\nbody`, marker)).toBe(false);
  });

  it('does not match a prefix of the identifier', () => {
    expect(hasMarker(`${markerFor('siz')}\n\nbody`, marker)).toBe(false);
  });
});

describe('composeBody', () => {
  it('puts the marker ahead of the body', () => {
    expect(composeBody('size', 'the report')).toEqual({
      text: '<!-- timschoenle/actions:issue:size -->\n\nthe report',
      truncated: false,
    });
  });

  it('leaves a body that fits untouched', () => {
    const body = 'x'.repeat(1000);

    expect(composeBody('size', body).text).toContain(body);
  });

  it('cuts a body that does not fit, and says so', () => {
    const result = composeBody('size', 'x'.repeat(MAX_ISSUE_BODY_LENGTH));

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(MAX_ISSUE_BODY_LENGTH);
    expect(result.text).toContain('The rest of this issue was cut');
  });

  it('keeps the marker findable after a cut', () => {
    const result = composeBody('size', 'x'.repeat(MAX_ISSUE_BODY_LENGTH * 2));

    expect(hasMarker(result.text, markerFor('size'))).toBe(true);
  });

  it('never cuts an astral character in half', () => {
    // A body of emoji is the shortest way to land a cut between the halves of a surrogate pair.
    const result = composeBody('size', '🐳'.repeat(MAX_ISSUE_BODY_LENGTH));

    expect(result.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
    expect(result.text.length).toBeLessThanOrEqual(MAX_ISSUE_BODY_LENGTH);
  });

  it('rejects an identifier that would escape the marker', () => {
    expect(() => composeBody('size --> <img src=x>', 'body')).toThrow(InvalidIdentifierError);
  });
});
