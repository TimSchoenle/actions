import Handlebars from 'handlebars';
import { describe, expect, it } from 'vitest';

import { HELPERS } from './helpers.js';
import { collectRequiredNames, findUndefinedReferences } from './strict-references.js';

const HELPER_NAMES = new Set(Object.keys(HELPERS));

function required(templateSource: string): string[] {
  return collectRequiredNames(Handlebars.parse(templateSource), HELPER_NAMES);
}

function undefinedIn(templateSource: string, variables: Record<string, unknown>): string[] {
  return findUndefinedReferences(Handlebars.parse(templateSource), variables, HELPER_NAMES);
}

describe('collectRequiredNames', () => {
  describe('the cases Handlebars strict mode misses', () => {
    it.each([
      ['a block argument', '{{#each actions}}x{{/each}}', ['actions']],
      ['an inverted block argument', '{{^unless flag}}x{{/unless}}', ['flag']],
      ['a conditional argument', '{{#if hasWorkflows}}x{{/if}}', ['hasWorkflows']],
      ['a helper argument', '{{ join tags }}', ['tags']],
      ['a sub-expression argument', '{{#each (sortBy actions "name")}}x{{/each}}', ['actions']],
      ['a nested sub-expression argument', '{{#if (not (eq status "ok"))}}x{{/if}}', ['status']],
      ['a hash argument', '{{#each items key=sortKey}}x{{/each}}', ['items', 'sortKey']],
    ])('finds %s', (_label, source, expected) => {
      expect(required(source)).toEqual(expected);
    });

    it('finds several names across one template', () => {
      const source = '{{#if hasWorkflows}}x{{/if}}\n{{#each actions}}y{{/each}}\n{{ join tags }}';

      expect(required(source)).toEqual(['hasWorkflows', 'actions', 'tags']);
    });

    it('reports each name once however often it is read', () => {
      expect(required('{{#each items}}a{{/each}}{{#each items}}b{{/each}}')).toEqual(['items']);
    });
  });

  describe('what it deliberately leaves alone', () => {
    // Handlebars' own strict mode already throws for these, with a message pointing at the exact
    // position. Duplicating the check here would only produce a worse one.
    it('ignores a bare interpolation', () => {
      expect(required('{{ title }}')).toEqual([]);
    });

    // `upper` is the helper being invoked, `title` is the variable it reads: only the latter is the
    // caller's to declare.
    it('ignores the helper name itself while keeping its argument', () => {
      expect(required('{{ upper title }}')).toEqual(['title']);
    });

    it('ignores a data variable', () => {
      expect(required('{{#each items}}{{ @index }}{{/each}}')).toEqual(['items']);
    });

    it('ignores this', () => {
      expect(required('{{#each items}}{{ this }}{{/each}}')).toEqual(['items']);
    });

    it('ignores a parent-scope reference, whose scope it does not model', () => {
      expect(required('{{#each items}}{{ join ../tags }}{{/each}}')).toEqual(['items']);
    });

    it('ignores literal arguments while keeping the variable ones', () => {
      expect(required('{{ default title "fallback" }}{{ json 1 }}{{ eq flag true }}')).toEqual(['title', 'flag']);
    });

    it('ignores a partial, whose context it cannot know', () => {
      expect(required('{{> row }}{{> row context }}')).toEqual([]);
    });

    it('ignores content and comments', () => {
      expect(required('plain text {{! a comment }} more text')).toEqual([]);
    });
  });

  describe('scope', () => {
    /**
     * The boundary that keeps this from producing false failures: inside a block, names resolve
     * against data whose shape the variables map does not describe.
     */
    it('does not descend into a block body', () => {
      expect(required('{{#each actions}}{{ join whateverThisIs }}{{/each}}')).toEqual(['actions']);
    });

    it('does not descend into an else branch', () => {
      expect(required('{{#if flag}}{{ join a }}{{else}}{{ join b }}{{/if}}')).toEqual(['flag']);
    });

    it('still checks a block argument nested in another block argument', () => {
      expect(required('{{#if (or (count rows) fallbackFlag)}}x{{/if}}')).toEqual(['rows', 'fallbackFlag']);
    });
  });

  it('reports names in first-appearance order, so a failure reads the same every run', () => {
    expect(required('{{#if z}}1{{/if}}{{#if a}}2{{/if}}{{#if m}}3{{/if}}')).toEqual(['z', 'a', 'm']);
  });
});

describe('findUndefinedReferences', () => {
  it('reports nothing when every name is defined', () => {
    expect(undefinedIn('{{#each actions}}x{{/each}}', { actions: [] })).toEqual([]);
  });

  it('reports the names that are missing', () => {
    expect(undefinedIn('{{#each actions}}x{{/each}}{{#if flag}}y{{/if}}', { actions: [] })).toEqual(['flag']);
  });

  // A flag that is off is a defined value, not an absent one; this is what makes the rule teachable.
  it.each([
    ['false', false],
    ['null', null],
    ['an empty string', ''],
    ['an empty array', []],
    ['zero', 0],
  ])('accepts a name defined as %s', (_label, value) => {
    expect(undefinedIn('{{#if flag}}x{{/if}}', { flag: value })).toEqual([]);
  });

  it('does not accept a name that only exists on the prototype', () => {
    expect(undefinedIn('{{#if constructor}}x{{/if}}', {})).toEqual(['constructor']);
  });
});
