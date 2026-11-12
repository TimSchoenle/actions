import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { quoteAllForLog, quoteForLog, quoteUrlForLog } from './log.js';

/** The command names the runner acts on, each of which a forged line would trigger. */
const RUNNER_COMMANDS = ['error', 'warning', 'notice', 'debug', 'add-mask', 'stop-commands', 'set-output', 'group'];

/** Written by code point rather than literally, so the file itself holds no control characters. */
function unit(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}

describe('quoteForLog', () => {
  it('leaves an ordinary value readable, in quotes', () => {
    expect(quoteForLog('1.0.0')).toBe('"1.0.0"');
  });

  it('distinguishes an empty value from an absent one', () => {
    expect(quoteForLog('')).toBe('""');
  });

  it('makes trailing whitespace visible rather than silently trimming it', () => {
    expect(quoteForLog('value  ')).toBe('"value  "');
  });

  it.each(RUNNER_COMMANDS)('emits no line the runner would read as ::%s::', (command) => {
    const quoted = quoteForLog(`harmless\n::${command}::payload\nmore`);

    expect(quoted).not.toContain('\n');
    // The text survives — the value is escaped for the log, not censored out of it.
    expect(quoted).toContain(`::${command}::payload`);
  });

  it.each([
    { name: 'a line feed', value: 'a\nb', expected: String.raw`"a\nb"` },
    { name: 'a carriage return', value: 'a\rb', expected: String.raw`"a\rb"` },
    { name: 'a tab', value: 'a\tb', expected: String.raw`"a\tb"` },
    { name: 'a quote', value: 'a"b', expected: String.raw`"a\"b"` },
    { name: 'a backslash', value: 'a\\b', expected: String.raw`"a\\b"` },
    { name: 'a NUL', value: `a${unit(0x00)}b`, expected: String.raw`"a\u0000b"` },
    { name: 'an ANSI escape', value: `a${unit(0x1b)}[2Kb`, expected: String.raw`"a\u001b[2Kb"` },
  ])('escapes $name', ({ value, expected }) => {
    expect(quoteForLog(value)).toBe(expected);
  });

  // `JSON.stringify` stops escaping at U+001F, so these reach a terminal intact without the sweep.
  it.each([
    { name: 'DEL', codePoint: 0x7f, expected: String.raw`"\u007f"` },
    { name: 'a C1 control', codePoint: 0x85, expected: String.raw`"\u0085"` },
    { name: 'the line separator', codePoint: 0x20_28, expected: String.raw`"\u2028"` },
    { name: 'the paragraph separator', codePoint: 0x20_29, expected: String.raw`"\u2029"` },
  ])('escapes $name, which JSON leaves literal', ({ codePoint, expected }) => {
    expect(quoteForLog(unit(codePoint))).toBe(expected);
  });

  // S16a: these reorder or hide text in the rendered log, so a value can read as something it is not.
  it.each([
    { name: 'a zero-width space', codePoint: 0x20_0b, expected: String.raw`"\u200b"` },
    { name: 'a right-to-left mark', codePoint: 0x20_0f, expected: String.raw`"\u200f"` },
    { name: 'a right-to-left override', codePoint: 0x20_2e, expected: String.raw`"\u202e"` },
    { name: 'a word joiner', codePoint: 0x20_60, expected: String.raw`"\u2060"` },
    { name: 'a first-strong isolate', codePoint: 0x20_68, expected: String.raw`"\u2068"` },
    { name: 'the Arabic letter mark', codePoint: 0x06_1c, expected: String.raw`"\u061c"` },
    { name: 'a byte order mark', codePoint: 0xfe_ff, expected: String.raw`"\ufeff"` },
  ])('escapes $name, which reorders or hides text', ({ codePoint, expected }) => {
    expect(quoteForLog(unit(codePoint))).toBe(expected);
  });

  // S16a: the runner's legacy `##[command]` syntax may be honoured mid-line, where quoting alone does
  // not reach. Breaking the prefix costs nothing whether or not it is.
  it('breaks a legacy ##[ command prefix, wherever it appears', () => {
    expect(quoteForLog('x ##[add-mask]hunter2')).toBe(String.raw`"x #\u0023[add-mask]hunter2"`);
    expect(quoteForLog('###[error]x')).not.toContain('##[');
  });

  it('round-trips through JSON.parse, never yields ##[ or a second line, whatever it is given', () => {
    const tricky = fc.constantFrom('#', '[', '##[', '\n', '\r', '\u2028', '\u202e', '\u200b', '"', '\\');
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.string({ unit: 'binary' }), tricky)).map((parts) => parts.join('')),
        (value) => {
          const quoted = quoteForLog(value);

          expect(JSON.parse(quoted)).toBe(value);
          expect(quoted).not.toContain('##[');
          expect(quoted).not.toMatch(/[\n\r\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('leaves printable non-ASCII text alone', () => {
    expect(quoteForLog('Grüße 日本語 🚀')).toBe('"Grüße 日本語 🚀"');
  });

  it('never yields a multi-line result, whatever it is given', () => {
    const hostile = [
      '::stop-commands::token\n::set-output name=token::leaked',
      '\r\n::error::forged',
      ' ::error::forged',
      `${'a'.repeat(1000)}\n::add-mask::x`,
      `${unit(0x20_28)}::error::forged`,
    ];

    for (const value of hostile) {
      expect(quoteForLog(value).split('\n')).toHaveLength(1);
    }
  });
});

describe('quoteUrlForLog', () => {
  it('strips credentials a URL carried', () => {
    expect(quoteUrlForLog('https://user:token@github.com/o/r/pull/1')).toBe('"https://github.com/o/r/pull/1"');
  });

  it('strips a username with no password', () => {
    expect(quoteUrlForLog('https://token@github.com/o/r')).toBe('"https://github.com/o/r"');
  });

  it('leaves an ordinary URL exactly as written', () => {
    expect(quoteUrlForLog('https://github.com/o/r/pull/1')).toBe('"https://github.com/o/r/pull/1"');
  });

  it('quotes a value that is not a URL rather than dropping it', () => {
    expect(quoteUrlForLog('not a url')).toBe('"not a url"');
    expect(quoteUrlForLog('')).toBe('""');
  });

  it('still collapses a hostile value onto one line', () => {
    expect(quoteUrlForLog('https://github.com/o/r\n::error::forged')).not.toContain('\n');
  });
});

describe('quoteAllForLog', () => {
  it('quotes every element, so one hostile member cannot escape the line', () => {
    expect(quoteAllForLog(['a', 'b\n::error::forged'])).toBe(String.raw`"a", "b\n::error::forged"`);
  });

  it('renders an empty list as an empty string', () => {
    expect(quoteAllForLog([])).toBe('');
  });
});
