import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatValue, generateYamlString, inferValueType } from 'actions-util/yaml';
import { modifyYaml } from './modify.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Independent oracle for the documented inference contract: a decimal number only when it writes back
 * as exactly the text given (and, for an integer, is a safe integer), .inf/.nan in their YAML and
 * JavaScript spellings, booleans and null. Anything else stays a string, so `1.10` is never written as
 * `1.1` and `0123` never as `123`.
 *
 * Deliberately reimplemented rather than delegating to `inferValueType`, so a regression in the
 * implementation cannot make the tests agree with it.
 */
function expectedInference(input: string): string | number | boolean | null {
  const asNumber = Number(input);
  if (
    /^-?[\d.eE+-]+$/.test(input) &&
    Number.isFinite(asNumber) &&
    `${asNumber}` === input &&
    (!Number.isInteger(asNumber) || Number.isSafeInteger(asNumber))
  ) {
    return asNumber;
  }
  if (input === 'Infinity' || input === '+Infinity' || input === '.inf') return Infinity;
  if (input === '-Infinity' || input === '-.inf') return -Infinity;
  if (input === '.nan') return Number.NaN;
  if (input === 'true') return true;
  if (input === 'false') return false;
  if (input === 'null') return null;
  return input;
}

/**
 * Whether a value can hold the next path segment as a key.
 *
 * Arrays are excluded even though `typeof [] === 'object'`: `yaml.stringify` serializes only their
 * indexed entries, so a string key set on one never reaches the file and the key path under test
 * would be absent by construction.
 */
function canHoldKeys(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Helper to create a temp file for fuzzing
async function withTempFile(content: string, callback: (path: string) => Promise<void>) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fuzz-test-'));
  const tmpFile = path.join(tmpDir, 'fuzz.yaml');
  try {
    await fs.writeFile(tmpFile, content);
    await callback(tmpFile);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('modifyYaml Fuzzing', () => {
  it('should safely modify deeply nested YAML structures even with ugly formatting', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
        fc.array(
          fc.string({ minLength: 1 }).filter((k) => !k.includes('.') && k !== '__proto__' && k !== 'prototype'),
          { minLength: 1, maxLength: 5 },
        ), // Path segments
        fc.string(), // New value
        fc.string(), // Random comment/whitespace injection
        async (baseObj: any, pathSegments, newValue, corruption) => {
          const keyPath = pathSegments.join('.');

          // Construct the nested structure based on pathSegments
          let current = baseObj;
          for (let i = 0; i < pathSegments.length - 1; i++) {
            const segment = pathSegments[i];
            if (!canHoldKeys(current[segment])) {
              current[segment] = {};
            }
            current = current[segment];
          }
          // Set initial value at target
          const lastSegment = pathSegments[pathSegments.length - 1];
          current[lastSegment] = 'initial_value';

          const { stringify, parse } = await import('yaml');
          let initialYaml = stringify(baseObj);

          const safeCorruption = corruption.replace(/[^a-zA-Z0-9 ]/g, ''); // Clean for comment usage
          if (safeCorruption) {
            initialYaml = initialYaml.replace(/\n/g, ` # ${safeCorruption}\n`);
          }

          await withTempFile(initialYaml, async (filePath) => {
            await modifyYaml(filePath, keyPath, newValue);

            const resultContent = await fs.readFile(filePath, 'utf-8');
            const resultDoc = parse(resultContent);

            // 1. Check validity
            expect(resultDoc).toBeDefined();

            // 2. Resolve value in result doc
            let resultValue = resultDoc;
            for (const segment of pathSegments) {
              resultValue = resultValue?.[segment];
            }

            // 3. The written value is inferred, not stored verbatim: a number only when it writes back
            // as the same text, so `1.10` and `0x0` come back as the strings they were.
            expect(resultValue).toEqual(expectedInference(newValue));
          });
        },
      ),
    );
  });
});

describe('Primitive Persistence Fuzzing', () => {
  // Generate actual primitives, stringify them as input, verify they come back as primitives
  it('should persist primitive types correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.integer(),
          // An integer past 2^53 is left out: it may round to a neighbour, so it stays a string by design.
          fc.float({ noNaN: true }).filter((value) => !Number.isInteger(value) || Number.isSafeInteger(value)),
          fc.boolean(),
          fc.constant(null),
        ),
        fc.array(
          fc.string({ minLength: 1 }).filter((k) => !k.includes('.') && k !== '__proto__' && k !== 'prototype'),
          { minLength: 1, maxLength: 3 },
        ),
        async (originalValue, pathSegments) => {
          const keyPath = pathSegments.join('.');
          // Simulate action input: everything comes in as string. String(-0) is "0", which is written
          // as 0; the text "-0" itself stays a string, because no number writes back as it.
          const inputString = String(originalValue);
          const expectedValue = Object.is(originalValue, -0) ? 0 : originalValue;

          // Initial file state: empty object or specific path
          const initialObj = {};

          let current: any = initialObj;
          for (let i = 0; i < pathSegments.length - 1; i++) {
            current[pathSegments[i]] = {};
            current = current[pathSegments[i]];
          }
          // Set a dummy value at the target so it exists (modifyYaml expectation)
          current[pathSegments[pathSegments.length - 1]] = 'old';

          const { stringify, parse } = await import('yaml');
          const initialYaml = stringify(initialObj);

          await withTempFile(initialYaml, async (filePath) => {
            await modifyYaml(filePath, keyPath, inputString);

            // Resolve result
            let val = parse(await fs.readFile(filePath, 'utf-8'));
            for (const seg of pathSegments) val = val[seg];

            expect(val).toBe(expectedValue);
            if (originalValue !== null) {
              expect(typeof val).toBe(typeof originalValue);
            } else {
              expect(val).toBeNull();
            }
          });
        },
      ),
    );
  });
});

describe('Helper Functions Fuzzing', () => {
  // 1. inferValueType
  it('inferValueType should be consistent', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        // toBe uses Object.is, so -0 and NaN are compared exactly.
        expect(inferValueType(input)).toBe(expectedInference(input));
      }),
    );
  });

  // 2. generateYamlString
  it('generateYamlString should produce valid YAML scalar that rounds-trips', async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)), async (input) => {
        // Our surgical splice logic REJECTS newlines. generateYamlString is only used for non-multiline.
        if (typeof input === 'string' && input.includes('\n')) return;

        const yamlString = generateYamlString(input);

        // Verify it parses back
        const { parse } = await import('yaml');
        // We simulate the context: "dummyKey: " + yamlString
        const doc = parse(`dummyKey: ${yamlString}`);

        // Special handling for empty/whitespace string which we quote specifically
        // If input is "", yamlString is '""'. Parse -> "".
        if (input === undefined) return;

        expect(doc.dummyKey).toEqual(input);
      }),
    );
  });

  // 3. formatValue
  it('formatValue should never throw', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => formatValue(input)).not.toThrow();
        expect(typeof formatValue(input)).toBe('string');
      }),
    );
  });
});
