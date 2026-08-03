/**
 * Property tests for the guarantees the action's security model rests on.
 *
 * The unit tests check the cases that were thought of. These check the ones that were not: whatever
 * a caller puts in `images`, `variables`, `value-template` or `changelog`, the action either refuses
 * it or produces something within a stated bound. A regression here is a hole, not a cosmetic bug.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InvalidInputError, parseImages, parseVariables } from './inputs.js';
import { planImageEdits } from './update.js';
import { renderTemplate, TemplateError } from './template.js';
import { sanitizeChangelog } from './changelog.js';

import type { UpdateRequest } from './update.js';

const KEY_PATTERN = /^([A-Za-z0-9_-]+\.)*image\.tag$/;
const VALUE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}(@sha256:[0-9a-f]{64})?$/;
const PROTOTYPE_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/** Any JSON text at all, plus deliberately hostile shapes an attacker would reach for first. */
const anyJsonText = fc.oneof(
  fc.json(),
  fc.constantFrom(
    '{"__proto__": {"polluted": true}}',
    '{"a.image.tag": {"__proto__": "x"}}',
    '{"constructor.prototype.image.tag": {"tag": "v1"}}',
    '{"../../.github/workflows/ci.image.tag": {"tag": "v1"}}',
    '{"a..b.image.tag": {"tag": "v1"}}',
    '[]',
    'null',
  ),
);

function baseRequest(overrides: Partial<UpdateRequest>): UpdateRequest {
  return {
    chartFile: 'Chart.yaml',
    valuesFile: 'values.yaml',
    images: [],
    sharedVariables: new Map(),
    valueTemplate: '${tag}@${digest}',
    keyPattern: KEY_PATTERN,
    valuePattern: VALUE_PATTERN,
    chartVersion: '1.0.1',
    previousChartVersion: '1.0.0',
    appVersion: undefined,
    ...overrides,
  };
}

describe('images parsing', () => {
  it('either rejects the input or yields keys that are safe to hand to a YAML document', () => {
    fc.assert(
      fc.property(anyJsonText, (raw) => {
        let entries;

        try {
          entries = parseImages(raw);
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidInputError);

          return;
        }

        for (const entry of entries) {
          const segments = entry.key.split('.');

          expect(segments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))).toBe(true);
          expect(segments.some((segment) => PROTOTYPE_NAMES.has(segment))).toBe(false);
          expect(segments.length).toBeLessThanOrEqual(10);
        }
      }),
    );
  });

  it('never yields a variable that could change meaning in YAML, Markdown or a shell', () => {
    fc.assert(
      fc.property(anyJsonText, (raw) => {
        let entries;

        try {
          entries = parseImages(raw);
        } catch {
          return;
        }

        for (const entry of entries) {
          for (const [name, value] of entry.variables) {
            expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
            expect(value).toMatch(/^[A-Za-z0-9._:@/+-]{1,256}$/);
          }
        }
      }),
    );
  });

  it('never lets a prototype key become a real entry', () => {
    fc.assert(
      fc.property(anyJsonText, (raw) => {
        try {
          parseVariables(raw);
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidInputError);
        }

        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      }),
    );
  });
});

describe('template rendering', () => {
  const variableName = fc.stringMatching(/^[a-z][a-z0-9_]*$/);
  const variableValue = fc.stringMatching(/^[A-Za-z0-9._:@/+-]{1,32}$/);

  it('produces only characters drawn from the template and the values it was given', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), fc.dictionary(variableName, variableValue), (template, bag) => {
        let rendered;

        try {
          rendered = renderTemplate(template, new Map(Object.entries(bag)), 'ctx');
        } catch (error) {
          expect(error).toBeInstanceOf(TemplateError);

          return;
        }

        expect(rendered).not.toContain('\n');
        expect(rendered).not.toContain('${');
      }),
    );
  });

  // With per-image versions this is the guarantee that matters most: a chart must never claim to
  // ship a build that was never produced because one service borrowed another's tag.
  it('never lets one entry read another entry variables', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), { minLength: 2, maxLength: 6 }),
        (names) => {
          const images = Object.fromEntries(
            names.map((name, index) => [`services.${name}.image.tag`, { tag: `v${index}` }]),
          );

          const edits = planImageEdits(
            baseRequest({ valueTemplate: '${tag}', images: parseImages(JSON.stringify(images)) }),
          );

          expect(edits.map((edit) => edit.value)).toEqual(names.map((_name, index) => `v${index}`));
        },
      ),
    );
  });

  it('writes exactly the keys it was asked to write, and no others', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), { minLength: 1, maxLength: 8 }),
        (names) => {
          const images = Object.fromEntries(names.map((name) => [`services.${name}.image.tag`, { tag: 'v1' }]));

          const edits = planImageEdits(
            baseRequest({ valueTemplate: '${tag}', images: parseImages(JSON.stringify(images)) }),
          );

          expect(edits.map((edit) => edit.key)).toEqual(Object.keys(images));
        },
      ),
    );
  });
});

describe('changelog sanitization', () => {
  const maxBytes = fc.integer({ min: 64, max: 4096 });

  it('stays within the byte cap', () => {
    fc.assert(
      fc.property(fc.string(), maxBytes, (raw, cap) => {
        expect(new TextEncoder().encode(sanitizeChangelog(raw, cap)).length).toBeLessThanOrEqual(cap);
      }),
    );
  });

  it('leaves no construct that notifies a person or closes an issue', () => {
    fc.assert(
      fc.property(fc.string(), maxBytes, (raw, cap) => {
        const sanitized = sanitizeChangelog(raw, cap);

        expect(sanitized).not.toMatch(/(^|[^\w`])@[A-Za-z0-9]/);
        expect(sanitized).not.toMatch(/\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(#\d+|https?:\/\/)/i);
      }),
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), maxBytes, (raw, cap) => {
        const once = sanitizeChangelog(raw, cap);

        expect(sanitizeChangelog(once, cap)).toBe(once);
      }),
    );
  });
});
