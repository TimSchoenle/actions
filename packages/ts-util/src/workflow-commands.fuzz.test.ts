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

  it.prop([fc.uuid(), hostile, hostile])(
    'refuses every value that contains the delimiter, wherever it sits',
    (id, before, after) => {
      expect(() => prepareKeyValueMessage('key', `${before}ghadelimiter_${id}${after}`, id)).toThrow(
        /should not contain the delimiter/,
      );
    },
  );
});
