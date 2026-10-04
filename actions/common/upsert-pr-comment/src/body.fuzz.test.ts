import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';

import { composeLines } from './body.js';

/** Lines that mix blank, whitespace-only and hostile content, joined by either line ending. */
const line = fc.oneof(
  fc.constant(''),
  fc.stringMatching(/^[ \t]*$/),
  fc.string({ unit: 'grapheme' }),
  fc.constantFrom('::add-mask::x', '${{ secrets.GITHUB_TOKEN }}', '$INPUT_TOKEN', '%INPUT_TOKEN%', '$(id)'),
);
const lineEnding = fc.constantFrom('\n', '\r\n');

/** Surviving lines may not contain a line break, or the property below would split them differently. */
const singleLine = line.map((value) => value.replaceAll(/[\r\n]/g, ''));

describe('composeLines properties', () => {
  it.prop([fc.array(singleLine), lineEnding])(
    'keeps exactly the non-blank lines, verbatim and in order, and skips when there are none',
    (lines, ending) => {
      const expected = lines.filter((value) => value.trim() !== '');

      const composed = composeLines(lines.join(ending), '', '');

      if (expected.length === 0) {
        expect(composed).toBeUndefined();
      } else {
        expect(composed).toBe(expected.join('\n'));
      }
    },
  );

  // The action interpolates nothing: whatever looks like a reference to a secret, an environment
  // variable or a command reaches the comment as the same characters it arrived as.
  it.prop([fc.array(singleLine, { minLength: 1 }), fc.string(), fc.string()])(
    'adds nothing to the lines but the header and footer',
    (lines, header, footer) => {
      const composed = composeLines(lines.join('\n'), header, footer);

      if (composed === undefined) {
        return;
      }

      const body = lines.filter((value) => value.trim() !== '').join('\n');

      expect(composed).toBe([header, body, footer].filter((block) => block !== '').join('\n\n'));
    },
  );

  it.prop([fc.string()])('never throws, whatever it is handed', (value) => {
    expect(() => composeLines(value, '', '')).not.toThrow();
  });
});
