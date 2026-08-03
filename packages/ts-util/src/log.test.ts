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
