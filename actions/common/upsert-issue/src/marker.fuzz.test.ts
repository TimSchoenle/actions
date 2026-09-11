import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';

import { composeBody, hasMarker, markerFor, MAX_ISSUE_BODY_LENGTH } from './marker.js';

const identifier = fc.stringMatching(/^[\dA-Za-z][\w.-]{0,63}$/);

describe('marker properties', () => {
  it.prop([identifier])('produces a marker that is one line and closes itself exactly once', (value) => {
    const marker = markerFor(value);

    expect(marker.split('\n')).toHaveLength(1);
    expect(marker.split('-->')).toHaveLength(2);
    expect(marker.endsWith('-->')).toBe(true);
  });

  it.prop([identifier, identifier])('matches its own identifier and no other', (left, right) => {
    const body = `${markerFor(left)}\n\nbody`;

    expect(hasMarker(body, markerFor(left))).toBe(true);
    expect(hasMarker(body, markerFor(right))).toBe(left === right);
  });

  it.prop([identifier, fc.string()])('always yields a findable marker within the size limit', (value, body) => {
    const { text } = composeBody(value, body);

    expect(hasMarker(text, markerFor(value))).toBe(true);
    expect(text.length).toBeLessThanOrEqual(MAX_ISSUE_BODY_LENGTH);
  });

  it.prop([fc.string()])('accepts an identifier only when it survives its own marker', (value) => {
    let marker;

    try {
      marker = markerFor(value);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return;
    }

    // The round trip is the property that matters: whatever was accepted has to be recoverable from
    // the line, which it cannot be if it carried a newline or closed the comment early.
    expect(marker).toBe(`<!-- timschoenle/actions:issue:${value} -->`);
    expect(hasMarker(marker, marker)).toBe(true);
  });
});
