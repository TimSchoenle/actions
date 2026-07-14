import { fc } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import { readYaml } from './read.js';

import type { YamlFileReader } from 'actions-util';

const FILE = 'fuzz.yaml';

/** Serves a single in-memory document, so fuzzing never touches the file system. */
function fileWith(content: string): YamlFileReader {
  return async (requested) => (requested === FILE ? content : undefined);
}

/** Path segments a dot-path can address: no `.` (it is the separator) and no prototype pollution. */
const segment = fc
  .string({ minLength: 1 })
  .filter((key) => !key.includes('.') && key !== '__proto__' && key !== 'prototype');

const segments = fc.array(segment, { maxLength: 5, minLength: 1 });

/** Builds `{ a: { b: { c: leaf } } }` for the path `a.b.c`. */
function nest(pathSegments: readonly string[], leaf: unknown): Record<string, unknown> {
  return pathSegments.reduceRight<Record<string, unknown>>(
    (accumulator, key) => ({ [key]: accumulator }),
    leaf as Record<string, unknown>,
  );
}

describe('readYaml fuzzing', () => {
  it('returns a string leaf exactly as it was written', async () => {
    await fc.assert(
      fc.asyncProperty(segments, fc.string(), async (pathSegments, leaf) => {
        const document = stringify(nest(pathSegments, leaf));

        const value = await readYaml(FILE, pathSegments.join('.'), fileWith(document));

        expect(value).toBe(leaf);
      }),
    );
  });

  // The bash predecessor delegated stringification to `yq`, which prints the scalar's source text.
  // Coercing through the JS value instead would turn `1.0` into `1` and `007` into `7`.
  it('never rewrites the source text of a scalar', async () => {
    const scalarSource = fc.stringMatching(/^[\w-]+(\.[\w-]+)*$/).filter((source) => !source.startsWith('-'));

    await fc.assert(
      fc.asyncProperty(scalarSource, async (source) => {
        const value = await readYaml(FILE, 'value', fileWith(`value: ${source}\n`));

        expect(value).toBe(source);
      }),
    );
  });

  it('serializes a map subtree to YAML that parses back to the same value', async () => {
    const jsonMap = fc.dictionary(segment, fc.jsonValue(), { minKeys: 1 });

    await fc.assert(
      fc.asyncProperty(segments, jsonMap, async (pathSegments, subtree) => {
        const document = stringify(nest(pathSegments, subtree));

        const value = await readYaml(FILE, pathSegments.join('.'), fileWith(document));

        expect(parse(value)).toEqual(parse(stringify(subtree)));
      }),
    );
  });

  it('fails with "not found" for any key the document does not contain', async () => {
    await fc.assert(
      fc.asyncProperty(segments, fc.string(), async (pathSegments, leaf) => {
        const document = stringify(nest(pathSegments, leaf));
        const absent = ['absent', ...pathSegments].join('.');

        await expect(readYaml(FILE, absent, fileWith(document))).rejects.toThrow(/not found/);
      }),
    );
  });

  // A workflow author controls both inputs; neither must be able to produce anything other than a
  // string output or a step failure carrying a readable message.
  it('either resolves to a string or rejects with an Error, for any input', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (document, key) => {
        try {
          expect(typeof (await readYaml(FILE, key, fileWith(document)))).toBe('string');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).not.toBe('');
        }
      }),
    );
  });
});
