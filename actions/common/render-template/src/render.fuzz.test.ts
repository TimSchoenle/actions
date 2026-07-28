import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { renderTemplate } from './render.js';
import { normalizeSource } from './template-file.js';

import type { RenderRequest } from './render.js';
import type { TemplateMap } from './variables.js';

/**
 * Text carrying no Handlebars syntax.
 *
 * `{`, `}` and `\` are the only characters the grammar reacts to — mustaches and the escape that
 * suppresses them — so removing them leaves arbitrary text that must render as itself.
 */
const literalText = fc.string({ maxLength: 200 }).map((text) => text.replaceAll(/[{}\\]/g, ''));

const scalar = fc.oneof(fc.string(), fc.integer(), fc.boolean());

function render(templateSource: string, variables: TemplateMap, overrides: Partial<RenderRequest> = {}): string {
  return renderTemplate({
    templatePath: 'fuzz.hbs',
    templateSource,
    variables,
    partials: [],
    strict: true,
    escapeHtml: false,
    ...overrides,
  });
}

describe('renderTemplate fuzzing', () => {
  it('renders text with no references as itself', () => {
    fc.assert(
      fc.property(literalText, (text) => {
        expect(render(text, {})).toBe(text);
      }),
    );
  });

  /**
   * The property the whole drift check rests on.
   *
   * If rendering could vary between two runs of the same request, `check: true` would fail on files
   * nobody changed and the action would be worse than useless in CI.
   */
  it('produces identical output for identical requests', () => {
    fc.assert(
      fc.property(literalText, scalar, fc.array(scalar, { maxLength: 6 }), (text, value, items) => {
        const source = `${text}{{ value }}\n{{#each (sort items)}}{{ this }},{{/each}}`;
        const variables: TemplateMap = { value, items } as TemplateMap;

        expect(render(source, variables)).toBe(render(source, variables));
      }),
    );
  });

  it('interpolates a value verbatim when escaping is off', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (value) => {
        expect(render('{{ value }}', { value })).toBe(value);
      }),
    );
  });

  // Sorting must not depend on the order the caller happened to supply, or a reordered input
  // produces a diff in a generated file that is not a real change.
  it('sorts a list into the same order however it was supplied', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string({ maxLength: 8 }), { maxLength: 8 }), (items) => {
        const source = '{{#each (sort items)}}{{ this }} {{/each}}';

        expect(render(source, { items: [...items].reverse() })).toBe(render(source, { items }));
      }),
    );
  });

  it('escapes every pipe and newline out of a table cell', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (value) => {
        const cell = render('{{ mdCell value }}', { value });

        expect(cell).not.toMatch(/(?<!\\)\|/);
        expect(cell).not.toMatch(/[\n\r]/);
      }),
    );
  });

  it('never resolves a prototype member, whatever the variables are named', () => {
    fc.assert(
      fc.property(fc.constantFrom('constructor', 'toString', 'valueOf', 'hasOwnProperty'), (name) => {
        expect(render(`{{ ${name} }}`, { safe: 'value' }, { strict: false })).toBe('');
      }),
    );
  });

  it('normalizes any line endings a template file could carry', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('\r\n', '\n', '\r', 'a'), { maxLength: 40 }), (parts) => {
        expect(render(normalizeSource(parts.join('')), {})).not.toMatch(/\r/);
      }),
    );
  });
});
