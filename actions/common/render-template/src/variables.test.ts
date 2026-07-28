import { describe, expect, it } from 'vitest';

import { UnsafeVariableKeyError, VariablesParseError } from './errors.js';
import { parseVariables } from './variables.js';

describe('parseVariables', () => {
  it('returns an empty context for an empty input', () => {
    expect(parseVariables('')).toEqual({});
  });

  it('returns an empty context for a whitespace-only input', () => {
    expect(parseVariables('  \n\t ')).toEqual({});
  });

  it('parses a flat object', () => {
    expect(parseVariables('{"name":"actions","count":3,"on":true,"none":null}')).toEqual({
      name: 'actions',
      count: 3,
      on: true,
      none: null,
    });
  });

  it('parses nested objects and arrays', () => {
    const parsed = parseVariables('{"repo":{"tags":["a","b"],"meta":{"stars":7}}}');

    expect(parsed).toEqual({ repo: { tags: ['a', 'b'], meta: { stars: 7 } } });
  });

  it('preserves key order, which decides the order an each over an object renders in', () => {
    expect(Object.keys(parseVariables('{"z":1,"a":2,"m":3}'))).toEqual(['z', 'a', 'm']);
  });

  describe('rejections', () => {
    it('rejects invalid JSON', () => {
      expect(() => parseVariables('{name: "actions"}')).toThrow(VariablesParseError);
    });

    // YAML is the syntax a workflow author reaches for by reflex; the message has to be specific
    // enough that they see it is the wrong one rather than assume a bug.
    it('reports invalid JSON with the parser reason', () => {
      expect(() => parseVariables('name: actions')).toThrow(/variables: is not valid JSON\./);
    });

    it.each([
      ['an array', '[1,2]', /must be a JSON object, got an array/],
      ['a string', '"actions"', /must be a JSON object, got string/],
      ['a number', '42', /must be a JSON object, got number/],
      ['null', 'null', /must be a JSON object, got object/],
    ])('rejects %s at the top level', (_label, raw, message) => {
      expect(() => parseVariables(raw)).toThrow(message);
    });

    it.each(['__proto__', 'constructor', 'prototype'])('rejects the top-level key %s', (key) => {
      expect(() => parseVariables(`{${JSON.stringify(key)}:{}}`)).toThrow(UnsafeVariableKeyError);
    });

    it('rejects a prototype-reaching key nested in an object', () => {
      expect(() => parseVariables('{"repo":{"constructor":1}}')).toThrow(UnsafeVariableKeyError);
    });

    it('rejects a prototype-reaching key nested in an array', () => {
      expect(() => parseVariables('{"rows":[{"a":1},{"__proto__":1}]}')).toThrow(UnsafeVariableKeyError);
    });

    it('names the offending key and its position', () => {
      expect(() => parseVariables('{"rows":[{"prototype":1}]}')).toThrow(/'prototype' at '\$\.rows\[0\]'/);
    });

    it('rejects nesting past the depth limit instead of exhausting the stack', () => {
      const depth = 200;
      const raw = `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;

      expect(() => parseVariables(raw)).toThrow(/exceeds the maximum depth/);
    });
  });

  describe('prototype safety of the result', () => {
    it('does not pollute Object.prototype', () => {
      expect(() => parseVariables('{"__proto__":{"polluted":true}}')).toThrow(UnsafeVariableKeyError);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('produces objects that carry no caller-supplied prototype', () => {
      const parsed = parseVariables('{"repo":{"name":"actions"}}');

      expect(Object.getPrototypeOf(parsed.repo)).toBe(Object.prototype);
      expect(Object.hasOwn(parsed.repo as object, 'constructor')).toBe(false);
    });
  });
});
