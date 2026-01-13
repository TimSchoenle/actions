import { describe, expect } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { formatValue, generateYamlString, inferValueType, modifyYaml } from './modify.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

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
  test.prop([
    fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
    fc.array(
      fc.string({ minLength: 1 }).filter((k) => !k.includes('.') && k !== '__proto__' && k !== 'prototype'),
      { minLength: 1, maxLength: 5 },
    ), // Path segments
    fc.string(), // New value
    fc.string(), // Random comment/whitespace injection
  ])(
    'should safely modify deeply nested YAML structures even with ugly formatting',
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

        // 3. Expected value logic
        let expectedValue: any = newValue;
        if (/^-?\d+(\.\d+)?$/.test(newValue)) {
          expectedValue = Number(newValue);
        } else if (newValue === 'true') {
          expectedValue = true;
        } else if (newValue === 'false') {
          expectedValue = false;
        } else if (newValue === 'null') {
          expectedValue = null;
        }

        expect(resultValue).toEqual(expectedValue);
      });
    },
  );
});

describe('Primitive Persistence Fuzzing', () => {
  // Generate actual primitives, stringify them as input, verify they come back as primitives
  test.prop([
    fc.oneof(
      fc.integer(),
      fc.float({ noNaN: true, noInfinity: true }), // YAML supports .nan but our regex might not. Let's focus on standard numbers.
      fc.boolean(),
      fc.constant(null),
    ),
    fc.array(
      fc.string({ minLength: 1 }).filter((k) => !k.includes('.') && k !== '__proto__' && k !== 'prototype'),
      { minLength: 1, maxLength: 3 },
    ),
  ])('should persist primitive types correctly', async (originalValue, pathSegments) => {
    const keyPath = pathSegments.join('.');
    // Simulate action input: everything comes in as string
    // Special case: String(-0) is "0", but we want to test "-0" input preservation
    const inputString = Object.is(originalValue, -0) ? '-0' : String(originalValue);

    // Initial file state: empty object or specific path
    const initialObj = {};
    // We need to build the path so modifyYaml can find it?
    // modifyYaml throws if key not found? No, it throws if *parent* not found?
    // "Key '...' not found" if current value undefined?
    // Let's create the path in initialObj
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

      // Verify Type and Value
      // Special case: 1.0 becomes 1 in YAML if it looks like int?
      // JS number 1.0 IS 1.
      // But 1.23 should be 1.23.
      // inferValueType regex matches integers and floats.

      expect(val).toBe(originalValue);
      if (originalValue !== null) {
        expect(typeof val).toBe(typeof originalValue);
      } else {
        expect(val).toBeNull();
      }
    });
  });
});

describe('Helper Functions Fuzzing', () => {
  // 1. inferValueType
  // Property: Should correctly identify types or return string
  // Property: Parsed value should roughly match input string logical content
  test.prop([fc.string()])('inferValueType should be consistent', (input) => {
    const result = inferValueType(input);
    if (input === 'true') expect(result).toBe(true);
    else if (input === 'false') expect(result).toBe(false);
    else if (input === 'null') expect(result).toBe(null);
    else if (/^-?\d+(\.\d+)?$/.test(input)) expect(result).toBe(Number(input));
    else expect(result).toBe(input);
  });

  // 2. generateYamlString
  // Property: The generated string, when parsed back as a YAML value, should equal the input (Round Trip)
  // We treat the output as a value in a mapping "key: <output>".
  test.prop([fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))])(
    'generateYamlString should produce valid YAML scalar that rounds-trips',
    async (input) => {
      // Our surgical splice logic REJECTS newlines. generateYamlString is only used for non-multiline.
      if (typeof input === 'string' && input.includes('\n')) return;

      const yamlString = generateYamlString(input);

      // Verify it parses back
      const { parse } = await import('yaml');
      // We simulate the context: "dummyKey: " + yamlString
      const doc = parse(`dummyKey: ${yamlString}`);

      // Special handling for empty/whitespace string which we quote specifically
      // If input is "", yamlString is '""'. Parse -> "".
      if (input === undefined) return; // We don't handle undefined input in signature (any) but logic handles it?

      expect(doc.dummyKey).toEqual(input);
    },
  );

  // 3. formatValue
  // Property: Should never throw and return a string
  test.prop([fc.anything()])('formatValue should never throw', (input) => {
    expect(() => formatValue(input)).not.toThrow();
    expect(typeof formatValue(input)).toBe('string');
  });
});
