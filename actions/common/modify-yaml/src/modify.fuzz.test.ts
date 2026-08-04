import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatValue, generateYamlString, inferValueType } from 'actions-util';
import { modifyYaml } from './modify.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Independent oracle for the documented inference contract: YAML 1.2 core schema scalars
 * (decimal/float with exponent, unsigned hex/octal, .inf/.nan, booleans, null) plus the signed
 * hex/octal extension. Anything else stays a string.
 *
 * Deliberately reimplemented rather than delegating to `inferValueType`, so a regression in the
 * implementation cannot make the tests agree with it.
 */
function expectedInference(input: string): string | number | boolean | null {
  const isNegated = input.startsWith('-');
  const magnitude = isNegated ? input.slice(1) : input;

  if (/^0x[\da-fA-F]+$/i.test(magnitude) || /^0o[0-7]+$/.test(magnitude)) {
    return isNegated ? -Number(magnitude) : Number(magnitude);
  }
  // eslint-disable-next-line security/detect-unsafe-regex
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(input)) return Number(input);
  if (input === 'Infinity' || input === '+Infinity' || input === '.inf') return Infinity;
  if (input === '-Infinity' || input === '-.inf') return -Infinity;
  if (input === '.nan') return Number.NaN;
  if (input === 'true') return true;
  if (input === 'false') return false;
  if (input === 'null') return null;
  return input;
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
            if (current[segment] === undefined || typeof current[segment] !== 'object' || current[segment] === null) {
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

            // 3. The written value is inferred, not stored verbatim, so the round-trip lands on the
            // inferred scalar — `0x0` comes back as the number 0, `1e5` as 100000, and so on.
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
          fc.float({ noNaN: true }), // YAML supports .nan but our regex might not. Let's focus on standard numbers.
          fc.boolean(),
          fc.constant(null),
        ),
        fc.array(
          fc.string({ minLength: 1 }).filter((k) => !k.includes('.') && k !== '__proto__' && k !== 'prototype'),
          { minLength: 1, maxLength: 3 },
        ),
        async (originalValue, pathSegments) => {
          const keyPath = pathSegments.join('.');
          // Simulate action input: everything comes in as string
          // Special case: String(-0) is "0", but we want to test "-0" input preservation
          const inputString = Object.is(originalValue, -0) ? '-0' : String(originalValue);

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

            expect(val).toBe(originalValue);
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
