import { EOL } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  escapeData,
  escapeProperty,
  formatCommand,
  prepareKeyValueMessage,
  toCommandProperties,
  toCommandValue,
} from './workflow-commands.js';

describe('toCommandValue', () => {
  it('passes strings through and renders nullish values as empty', () => {
    expect(toCommandValue('a\nb')).toBe('a\nb');
    expect(toCommandValue(null)).toBe('');
    expect(toCommandValue(undefined)).toBe('');
  });

  it('unwraps a String object rather than serialising it', () => {
    expect(toCommandValue(new String('boxed'))).toBe('boxed');
  });

  it('renders anything else as JSON', () => {
    expect(toCommandValue(42)).toBe('42');
    expect(toCommandValue(false)).toBe('false');
    expect(toCommandValue({ a: [1, 'x'] })).toBe('{"a":[1,"x"]}');
  });
});

describe('escapeData', () => {
  it('escapes %, CR and LF, percent first so escapes are not escaped twice', () => {
    expect(escapeData('100%\r\nnext')).toBe('100%25%0D%0Anext');
    expect(escapeData('%0A')).toBe('%250A');
  });

  it('leaves the property separators alone', () => {
    expect(escapeData('a:b,c')).toBe('a:b,c');
  });
});

describe('escapeProperty', () => {
  it('additionally escapes : and ,', () => {
    expect(escapeProperty('a:b,c%\n')).toBe('a%3Ab%2Cc%25%0A');
  });
});

describe('formatCommand', () => {
  it('renders a command without properties', () => {
    expect(formatCommand('debug', {}, 'hello')).toBe('::debug::hello');
  });

  it('renders properties in order, escaped, and skips falsy ones', () => {
    expect(formatCommand('error', { title: 'T:1', file: '', line: 3, col: 0, endLine: undefined }, 'boom')).toBe(
      '::error title=T%3A1,line=3::boom',
    );
  });

  it('keeps the separating space when every property was skipped, as @actions/core does', () => {
    expect(formatCommand('error', { title: undefined }, 'boom')).toBe('::error ::boom');
  });

  it('names a missing command', () => {
    expect(formatCommand('', {}, 'x')).toBe('::missing.command::x');
  });

  it('cannot be made to span lines or inject a property', () => {
    const forged = formatCommand('warning', { title: 'x,file=evil::\n::error::' }, 'm\n::add-mask::secret');

    expect(forged).toBe('::warning title=x%2Cfile=evil%3A%3A%0A%3A%3Aerror%3A%3A::m%0A::add-mask::secret');
    expect(forged).not.toMatch(/[\r\n]/);
  });
});

describe('toCommandProperties', () => {
  it('maps the annotation properties to the runner names', () => {
    expect(
      toCommandProperties({ title: 't', file: 'f', startLine: 1, endLine: 2, startColumn: 3, endColumn: 4 }),
    ).toEqual({ title: 't', file: 'f', line: 1, endLine: 2, col: 3, endColumn: 4 });
  });

  it('maps no properties to none', () => {
    expect(toCommandProperties({})).toEqual({});
  });
});

describe('prepareKeyValueMessage', () => {
  it('writes the heredoc format with a random delimiter', () => {
    const message = prepareKeyValueMessage('name', 'line 1\nline 2');
    const match = /^name<<(ghadelimiter_[\da-f-]{36})\r?\nline 1\nline 2\r?\n(ghadelimiter_[\da-f-]{36})$/.exec(
      message,
    );

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(match?.[2]);
  });

  it('uses a fresh delimiter for every entry', () => {
    expect(prepareKeyValueMessage('a', 'b')).not.toBe(prepareKeyValueMessage('a', 'b'));
  });

  it('serialises a non-string value', () => {
    expect(prepareKeyValueMessage('n', { a: 1 }, 'id')).toBe(`n<<ghadelimiter_id${EOL}{"a":1}${EOL}ghadelimiter_id`);
  });

  it('refuses a value containing the delimiter', () => {
    expect(() => prepareKeyValueMessage('n', 'x\nghadelimiter_id\ny=1', 'id')).toThrow(
      'Unexpected input: value should not contain the delimiter "ghadelimiter_id"',
    );
  });

  it.each(['a\nb', 'a\rb', 'a\r\nb', '\nb'])('refuses the key %j, which contains a line break', (key) => {
    expect(() => prepareKeyValueMessage(key, 'v', 'id')).toThrow(
      'Unexpected input: name should not contain a line break',
    );
  });

  it('refuses a key containing the delimiter', () => {
    expect(() => prepareKeyValueMessage('ghadelimiter_id', 'v', 'id')).toThrow(
      'Unexpected input: name should not contain the delimiter "ghadelimiter_id"',
    );
  });
});
