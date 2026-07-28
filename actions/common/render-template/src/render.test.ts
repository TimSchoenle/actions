import { describe, expect, it } from 'vitest';

import { TemplateCompileError, TemplateRenderError, UndefinedReferenceError } from './errors.js';
import { renderTemplate } from './render.js';

import type { PartialTemplate } from './partials.js';
import type { RenderRequest } from './render.js';
import type { TemplateMap } from './variables.js';

function request(overrides: Partial<RenderRequest> = {}): RenderRequest {
  return {
    templatePath: 'README.hbs',
    templateSource: '',
    variables: {},
    partials: [],
    strict: true,
    escapeHtml: false,
    ...overrides,
  };
}

function render(templateSource: string, variables: TemplateMap = {}, overrides: Partial<RenderRequest> = {}): string {
  return renderTemplate(request({ templateSource, variables, ...overrides }));
}

function partial(name: string, source: string): PartialTemplate {
  return { name, path: `partials/${name}.hbs`, source };
}

describe('renderTemplate', () => {
  it('renders a template with no references verbatim', () => {
    const source = '# Title\n\nSome | pipes and `backticks`.\n';

    expect(render(source)).toBe(source);
  });

  it('interpolates a top-level value', () => {
    expect(render('v{{ version }}', { version: '1.2.3' })).toBe('v1.2.3');
  });

  it('interpolates a nested path', () => {
    expect(render('{{ repo.owner }}/{{ repo.name }}', { repo: { owner: 'acme', name: 'actions' } })).toBe(
      'acme/actions',
    );
  });

  it('renders a table from an array with each', () => {
    const source = '{{#each actions}}| {{ name }} | {{ category }} |\n{{/each}}';
    const variables = {
      actions: [
        { name: 'read-yaml', category: 'common' },
        { name: 'clippy', category: 'rust' },
      ],
    };

    expect(render(source, variables)).toBe('| read-yaml | common |\n| clippy | rust |\n');
  });

  it('exposes the each data variables', () => {
    const source = '{{#each items}}{{ @index }}:{{ this }}{{#unless @last}},{{/unless}}{{/each}}';

    expect(render(source, { items: ['a', 'b', 'c'] })).toBe('0:a,1:b,2:c');
  });

  it('takes both branches of an if', () => {
    const source = '{{#if enabled}}on{{else}}off{{/if}}';

    expect(render(source, { enabled: true })).toBe('on');
    expect(render(source, { enabled: false })).toBe('off');
  });

  it('renders a registered partial', () => {
    const partials = [partial('row', '| {{ name }} |')];

    expect(render('{{> row }}', { name: 'clippy' }, { partials })).toBe('| clippy |');
  });

  it('renders a nested partial by its path-derived name', () => {
    const partials = [partial('tables/actions', '{{#each rows}}{{ this }};{{/each}}')];

    expect(render('{{> tables/actions }}', { rows: ['a', 'b'] }, { partials })).toBe('a;b;');
  });

  it('lets a partial use the helpers', () => {
    const partials = [partial('cell', '{{ mdCell text }}')];

    expect(render('{{> cell }}', { text: 'a|b' }, { partials })).toBe('a\\|b');
  });

  // Handlebars indents a partial's output to the column of its call site by default, which turns a
  // Markdown table into an indented code block.
  it('does not re-indent a multi-line partial to its call site', () => {
    const partials = [partial('block', 'first\nsecond')];

    expect(render('  {{> block }}', {}, { partials })).toBe('  first\nsecond');
  });

  describe('strict mode', () => {
    it('fails on an undefined reference', () => {
      expect(() => render('{{ missing }}')).toThrow(TemplateRenderError);
    });

    it('names the missing reference and the template in the message', () => {
      expect(() => render('{{ missing }}')).toThrow(/README\.hbs.*missing/s);
    });

    it('fails on a path whose parent is defined but whose leaf is not', () => {
      expect(() => render('{{ repo.branch }}', { repo: { name: 'actions' } })).toThrow(TemplateRenderError);
    });

    it('renders an undefined reference as an empty string when disabled', () => {
      expect(render('[{{ missing }}]', {}, { strict: false })).toBe('[]');
    });

    /**
     * Handlebars' own strict mode covers a bare `{{ name }}` and nothing else, so these would
     * otherwise render as an empty table, an empty string and the inverse branch — a documentation
     * file that is quietly wrong and, being reproducible, passes the drift check.
     */
    describe('references Handlebars would silently resolve to undefined', () => {
      it.each([
        ['a block argument', '{{#each actions}}x{{/each}}'],
        ['a conditional argument', '{{#if hasWorkflows}}x{{/if}}'],
        ['a helper argument', '{{ join tags }}'],
        ['a sub-expression argument', '{{#each (sortBy actions "name")}}x{{/each}}'],
      ])('fails on %s', (_label, source) => {
        expect(() => render(source)).toThrow(UndefinedReferenceError);
      });

      it('lists every missing name at once', () => {
        expect(() => render('{{#each actions}}x{{/each}}{{#if flag}}y{{/if}}')).toThrow(/actions, flag/);
      });

      it('points the caller at both ways out', () => {
        expect(() => render('{{#each actions}}x{{/each}}')).toThrow(/Declare it.*strict: false/s);
      });

      it('accepts a name that is defined but falsy', () => {
        expect(render('{{#if flag}}on{{else}}off{{/if}}', { flag: false })).toBe('off');
      });

      it('renders them as empty when strict is off', () => {
        expect(render('[{{#each actions}}x{{/each}}]', {}, { strict: false })).toBe('[]');
      });

      it('does not reach into a block body, where names come from the data', () => {
        expect(render('{{#each rows}}{{ join cells }}{{/each}}', { rows: [{ cells: ['a', 'b'] }] })).toBe('a, b');
      });
    });
  });

  describe('escaping', () => {
    it('leaves interpolated values unescaped by default', () => {
      expect(render('{{ value }}', { value: '<b>&"\'</b>' })).toBe('<b>&"\'</b>');
    });

    it('HTML-escapes interpolated values when asked', () => {
      expect(render('{{ value }}', { value: '<b>' }, { escapeHtml: true })).toBe('&lt;b&gt;');
    });

    it('still honours triple-stash when escaping is on', () => {
      expect(render('{{{ value }}}', { value: '<b>' }, { escapeHtml: true })).toBe('<b>');
    });
  });

  describe('prototype access', () => {
    it.each(['{{ constructor }}', '{{ constructor.constructor }}', '{{ toString }}', '{{ hasOwnProperty }}'])(
      'refuses to resolve %s',
      (source) => {
        // Under strict mode these names *exist* on the prototype chain, so the lookup itself
        // succeeds and Handlebars' access control is what has to deny the value.
        expect(render(source, { name: 'x' }, { strict: false })).toBe('');
      },
    );

    it('cannot reach a function through a nested value', () => {
      expect(render('{{ repo.constructor.name }}', { repo: { name: 'actions' } }, { strict: false })).toBe('');
    });
  });

  describe('isolation', () => {
    // Registration on the Handlebars singleton is global and permanent. Two renders in one process
    // must not see each other's partials.
    it('does not leak a partial into a later render', () => {
      render('{{> row }}', {}, { partials: [partial('row', 'x')] });

      expect(() => render('{{> row }}')).toThrow(TemplateRenderError);
    });
  });

  describe('failures', () => {
    it('reports an unparsable template as a compile error naming the template', () => {
      expect(() => render('{{#if a}}')).toThrow(TemplateCompileError);
      expect(() => render('{{#if a}}')).toThrow(/README\.hbs/);
    });

    it('reports an unparsable partial as a compile error naming the partial', () => {
      const partials = [partial('broken', '{{#each }}')];

      expect(() => render('{{> broken }}', {}, { partials })).toThrow(TemplateCompileError);
      expect(() => render('{{> broken }}', {}, { partials })).toThrow(/partials\/broken\.hbs/);
    });

    it('reports a missing partial as a render error', () => {
      expect(() => render('{{> absent }}')).toThrow(TemplateRenderError);
    });
  });

  it('is deterministic across repeated renders of the same request', () => {
    const source = '{{#each (sortBy actions "name")}}{{ name }},{{/each}}';
    const variables = { actions: [{ name: 'b' }, { name: 'a' }] };

    const first = render(source, variables);

    expect(render(source, variables)).toBe(first);
    expect(first).toBe('a,b,');
  });
});
