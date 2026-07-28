import { describe, expect, it } from 'vitest';

import { compareValues, HELPERS } from './helpers.js';
import { renderTemplate } from './render.js';

import type { TemplateMap } from './variables.js';

/**
 * Exercises helpers the way a template does, through the renderer.
 *
 * Calling them directly would skip the argument marshalling Handlebars performs — in particular the
 * trailing options object every helper receives, which is exactly what the positional-argument
 * handling has to get right.
 */
function render(templateSource: string, variables: TemplateMap = {}): string {
  return renderTemplate({
    templatePath: 'test.hbs',
    templateSource,
    variables,
    partials: [],
    strict: true,
    escapeHtml: false,
  });
}

describe('helpers', () => {
  describe('comparison', () => {
    it.each([
      ['{{#if (eq a b)}}y{{else}}n{{/if}}', { a: 1, b: 1 }, 'y'],
      ['{{#if (eq a b)}}y{{else}}n{{/if}}', { a: 1, b: 2 }, 'n'],
      ['{{#if (ne a b)}}y{{else}}n{{/if}}', { a: 'x', b: 'y' }, 'y'],
      ['{{#if (lt a b)}}y{{else}}n{{/if}}', { a: 1, b: 2 }, 'y'],
      ['{{#if (gt a b)}}y{{else}}n{{/if}}', { a: 'b', b: 'a' }, 'y'],
    ])('%s renders %s', (source, variables, expected) => {
      expect(render(source, variables as TemplateMap)).toBe(expected);
    });

    // A number compared against a number must not be compared as text, or 10 sorts before 9.
    it('compares numbers numerically, not lexically', () => {
      expect(compareValues(9, 10)).toBeLessThan(0);
      expect(compareValues('9', '10')).toBeGreaterThan(0);
    });
  });

  describe('logic', () => {
    it.each([
      ['{{#if (and a b)}}y{{else}}n{{/if}}', { a: true, b: true }, 'y'],
      ['{{#if (and a b)}}y{{else}}n{{/if}}', { a: true, b: false }, 'n'],
      ['{{#if (or a b)}}y{{else}}n{{/if}}', { a: false, b: true }, 'y'],
      ['{{#if (or a b)}}y{{else}}n{{/if}}', { a: false, b: false }, 'n'],
      ['{{#if (not a)}}y{{else}}n{{/if}}', { a: false }, 'y'],
    ])('%s renders %s', (source, variables, expected) => {
      expect(render(source, variables as TemplateMap)).toBe(expected);
    });

    // Handlebars treats an empty array as falsy; the helpers have to agree or `{{#if}}` and
    // `{{#if (or ...)}}` disagree about the same value.
    it('treats an empty array as falsy, as if does', () => {
      expect(render('{{#if (or items)}}y{{else}}n{{/if}}', { items: [] })).toBe('n');
      expect(render('{{#if items}}y{{else}}n{{/if}}', { items: [] })).toBe('n');
    });
  });

  describe('sorting', () => {
    it('sorts strings by code point', () => {
      expect(render('{{ join (sort items) "," }}', { items: ['c', 'a', 'b'] })).toBe('a,b,c');
    });

    it('sorts records by a property', () => {
      const variables = { rows: [{ n: 'c' }, { n: 'a' }, { n: 'b' }] };

      expect(render('{{#each (sortBy rows "n")}}{{ n }}{{/each}}', variables)).toBe('abc');
    });

    it('leaves ties in the order they were supplied', () => {
      const variables = {
        rows: [
          { n: 'a', id: 1 },
          { n: 'a', id: 2 },
          { n: 'a', id: 3 },
        ],
      };

      expect(render('{{#each (sortBy rows "n")}}{{ id }}{{/each}}', variables)).toBe('123');
    });

    it('does not consult the locale, so the order is the same on every runner', () => {
      // 'a' < 'B' by locale-aware collation but not by code point. Pinning this is the whole point:
      // a rendered file must not depend on the ICU data of the machine that produced it.
      expect(render('{{ join (sort items) "" }}', { items: ['a', 'B'] })).toBe('Ba');
    });

    it('reads a missing sort property as undefined rather than reaching the prototype', () => {
      const variables: TemplateMap = { rows: [{ n: 'b' }, { other: 1 }] };

      expect(render('{{#each (sortBy rows "n")}}{{ default n "-" }}{{/each}}', variables)).toBe('-b');
    });
  });

  describe('markdown', () => {
    it('escapes a pipe so it cannot split a table cell', () => {
      expect(render('{{ mdCell text }}', { text: 'a|b' })).toBe('a\\|b');
    });

    it('escapes backslashes before pipes so an escape is not doubled wrongly', () => {
      expect(render('{{ mdCell text }}', { text: 'a\\|b' })).toBe('a\\\\\\|b');
    });

    it('replaces newlines with a break so a cell cannot end its row', () => {
      expect(render('{{ mdCell text }}', { text: 'a\nb\r\nc' })).toBe('a<br>b<br>c');
    });

    it('escapes markdown structural characters', () => {
      expect(render('{{ mdEscape text }}', { text: '*bold* [link]' })).toBe('\\*bold\\* \\[link\\]');
    });
  });

  describe('values', () => {
    it.each([
      ['{{ join items }}', { items: ['a', 'b'] }, 'a, b'],
      ['{{ join items " / " }}', { items: ['a', 'b'] }, 'a / b'],
      ['{{ count items }}', { items: [1, 2, 3] }, '3'],
      ['{{ count text }}', { text: 'abcd' }, '4'],
      ['{{ count map }}', { map: { a: 1, b: 2 } }, '2'],
      ['{{ upper text }}', { text: 'ab' }, 'AB'],
      ['{{ lower text }}', { text: 'AB' }, 'ab'],
      ['{{ trim text }}', { text: '  x  ' }, 'x'],
      ['{{ default text "fallback" }}', { text: '' }, 'fallback'],
      ['{{ default text "fallback" }}', { text: 'given' }, 'given'],
      ['{{ replace text "-" "_" }}', { text: 'a-b-c' }, 'a_b_c'],
      ['{{ json value }}', { value: { b: 1, a: 2 } }, '{"b":1,"a":2}'],
    ])('%s renders %s', (source, variables, expected) => {
      expect(render(source, variables as TemplateMap)).toBe(expected);
    });

    it('joins a single value as if it were a one-element list', () => {
      expect(render('{{ join item }}', { item: 'only' })).toBe('only');
    });

    it('replaces every occurrence, not just the first', () => {
      expect(render('{{ replace text "a" "" }}', { text: 'banana' })).toBe('bnn');
    });
  });

  it('exposes no helper that could vary between runs', () => {
    const nondeterministic = ['now', 'today', 'date', 'random', 'uuid', 'env'];

    expect(Object.keys(HELPERS).filter((name) => nondeterministic.includes(name))).toEqual([]);
  });
});
