import { EOL } from 'node:os';

import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';

import { escapeData, escapeProperty, formatCommand, prepareKeyValueMessage } from './workflow-commands.js';

/** Reverses the escaping the runner undoes, longest escapes first so `%25` is decoded last. */
function unescape(value: string): string {
  return value
    .replaceAll('%0D', '\r')
    .replaceAll('%0A', '\n')
    .replaceAll('%3A', ':')
    .replaceAll('%2C', ',')
    .replaceAll('%25', '%');
}

/** Strings rich in the characters the escaping is about. */
const hostile = fc.string({
  unit: fc.oneof(
    fc.constantFrom('%', '\r', '\n', ':', ',', '::', '%0A', '%25', '=', ' '),
    fc.string({ minLength: 1, maxLength: 1 }),
  ),
});

/** Keys rich in the characters the runner splits a file command's first line at. */
const hostileKey = fc.string({
  unit: fc.oneof(
    fc.constantFrom('=', '<', '<<', '\r', '\n', '\r\n', ' ', 'ghadelimiter_'),
    fc.string({ minLength: 1, maxLength: 1 }),
  ),
});

/**
 * The key the runner reads from a heredoc entry's first line, or `undefined` where it would read no
 * heredoc entry: it reads up to the first line break, takes `name=value` when an `=` precedes the
 * first `<<`, and otherwise needs exactly one `<<` with text on both sides.
 */
function runnerKey(entry: string): { key: string; delimiter: string } | undefined {
  const [header] = entry.split(/\r\n|\r|\n/);
  const equalsIndex = header.indexOf('=');
  const heredocIndex = header.indexOf('<<');

  if (heredocIndex < 0 || (equalsIndex >= 0 && equalsIndex < heredocIndex)) {
    return undefined;
  }

  const parts = header.split('<<');

  return parts.length === 2 && parts[0] !== '' && parts[1] !== '' ? { key: parts[0], delimiter: parts[1] } : undefined;
}

describe('workflow command escaping properties', () => {
  it.prop([hostile])('never lets a message break the line', (value) => {
    expect(escapeData(value)).not.toMatch(/[\r\n]/);
  });

  it.prop([hostile])('never lets a property value end the property list or break the line', (value) => {
    expect(escapeProperty(value)).not.toMatch(/[\r\n:,]/);
  });

  it.prop([hostile])('escapes reversibly', (value) => {
    expect(unescape(escapeProperty(value))).toBe(value);
  });

  it.prop([hostile, hostile, hostile])(
    'renders one line from which the runner recovers exactly the properties and message given',
    (title, file, message) => {
      const line = formatCommand('error', { title, file }, message);
      const match = /^::error(?: ([^:]*))?::(.*)$/s.exec(line);

      expect(line).not.toMatch(/[\r\n]/);
      expect(match).not.toBeNull();

      const properties = Object.fromEntries(
        (match?.[1] ?? '')
          .split(',')
          .filter((entry) => entry !== '')
          .map((entry) => {
            const separator = entry.indexOf('=');

            return [entry.slice(0, separator), unescape(entry.slice(separator + 1))];
          }),
      );

      expect(properties).toEqual({ ...(title && { title }), ...(file && { file }) });
      expect(unescape(match?.[2] ?? '')).toBe(message);
    },
  );
});

describe('file command properties', () => {
  it.prop([fc.stringMatching(/^[\w-]+$/), hostile])(
    'writes an entry the runner reads back as exactly the value given',
    (key, value) => {
      const entry = prepareKeyValueMessage(key, value);
      const [header, ...rest] = entry.split(EOL);
      const delimiter = header.slice(key.length + 2);

      expect(header.startsWith(`${key}<<`)).toBe(true);
      expect(rest.at(-1)).toBe(delimiter);
      // The runner reads lines up to the first that is exactly the delimiter.
      expect(rest.slice(0, -1).join(EOL)).toBe(value);
      expect(rest.slice(0, -1)).not.toContain(delimiter);
    },
  );

  it.prop([hostileKey, fc.uuid()])(
    'accepts exactly the keys the runner reads back unchanged, and writes them so it does',
    (key, id) => {
      const delimiter = `ghadelimiter_${id}`;
      const read = runnerKey(`${key}<<${delimiter}`);
      const readsBack = read?.key === key && read.delimiter === delimiter;

      if (!readsBack) {
        expect(() => prepareKeyValueMessage(key, 'value', id)).toThrow(/^Unexpected input: name should not /);

        return;
      }

      const entry = prepareKeyValueMessage(key, 'value', id);

      expect(runnerKey(entry)).toEqual({ key, delimiter });
      expect(entry.split(EOL).at(-1)).toBe(delimiter);
    },
  );

  it.prop([fc.uuid(), hostile, hostile])(
    'refuses every value that contains the delimiter, wherever it sits',
    (id, before, after) => {
      expect(() => prepareKeyValueMessage('key', `${before}ghadelimiter_${id}${after}`, id)).toThrow(
        /should not contain the delimiter/,
      );
    },
  );
});
