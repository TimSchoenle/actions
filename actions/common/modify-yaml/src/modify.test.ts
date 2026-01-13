import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { modifyYaml, inferValueType, generateYamlString, formatValue } from './modify.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('modifyYaml', () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modify-yaml-test-'));
    tmpFile = path.join(tmpDir, 'test.yaml');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('Strict Preservation', () => {
    it('should strictly preserve all other lines in messy YAML', async () => {
      const messyYaml = `# Header Comment
root:
  # Indented comment
  child:  value    # Trailing comment with spaces
  
  sibling:   data  
list:
  - item1
  -   item2   # Badly indented list item`;
      await fs.writeFile(tmpFile, messyYaml);

      // Modify 'root.child'
      await modifyYaml(tmpFile, 'root.child', 'new_value');

      const content = await fs.readFile(tmpFile, 'utf-8');
      const lines = content.split('\n');

      // Verify specific line change
      expect(content).toContain('child:  new_value'); // Spaces preserved!

      // Verify preservation of other lines
      // With keepSourceTokens: true, we expect EXACT preservation, including "bad" whitespace.
      expect(lines[0]).toBe('# Header Comment');
      expect(content).toContain('  sibling:   data'); // Preserves "   " exactly
      expect(content).toContain('  -   item2   # Badly indented list item'); // Preserves "      " and "   #" exactly
    });

    it('should preserve comments on the target line itself', async () => {
      await fs.writeFile(tmpFile, 'key: value # my comment\n');
      await modifyYaml(tmpFile, 'key', 'new');
      const content = await fs.readFile(tmpFile, 'utf-8');
      expect(content).toContain('key: new # my comment');
    });
  });

  describe('Extended Strict Preservation', () => {
    it('should preserve exact whitespace before value', async () => {
      const yaml = 'key:     value';
      await fs.writeFile(tmpFile, yaml);
      await modifyYaml(tmpFile, 'key', 'new');
      const content = await fs.readFile(tmpFile, 'utf-8');
      expect(content).toBe('key:     new');
    });

    it('should preserve exact whitespace and comments after value', async () => {
      const yaml = 'key: value    # comment';
      await fs.writeFile(tmpFile, yaml);
      await modifyYaml(tmpFile, 'key', 'new');
      const content = await fs.readFile(tmpFile, 'utf-8');
      expect(content).toBe('key: new    # comment');
    });

    it('should preserve surrounding structure bit-for-bit', async () => {
      const yaml = `# Header
top:
  mid:
     bottom: value   # Target
  sibling:
     - item1
     - item2`;
      await fs.writeFile(tmpFile, yaml);
      await modifyYaml(tmpFile, 'top.mid.bottom', 'updated');
      const content = await fs.readFile(tmpFile, 'utf-8');

      // Split and verify lines to ensure exact match of non-touched lines
      const expected = yaml.replace('value', 'updated');
      expect(content).toBe(expected);
    });

    it('should handle deeply nested irregular indentation', async () => {
      const yaml = `
level1:
   level2:
      level3:
           target:  old
`;
      await fs.writeFile(tmpFile, yaml);
      await modifyYaml(tmpFile, 'level1.level2.level3.target', 'new');
      const content = await fs.readFile(tmpFile, 'utf-8');
      expect(content).toBe(`
level1:
   level2:
      level3:
           target:  new
`);
    });

    it('should preserve quoted keys', async () => {
      const yaml = '"my key": value';
      await fs.writeFile(tmpFile, yaml);
      await modifyYaml(tmpFile, 'my key', 'new');
      const content = await fs.readFile(tmpFile, 'utf-8');
      expect(content).toBe('"my key": new');
    });

    it('should safely modify value in flow style object', async () => {
      const yaml = 'obj: { a: 1, b: 2, c: 3 }';
      await fs.writeFile(tmpFile, yaml);
      await modifyYaml(tmpFile, 'obj.b', '99');
      const content = await fs.readFile(tmpFile, 'utf-8');
      // Expect minimal disruption.
      // Note: yaml library might treat "2" range as just the digit.
      expect(content).toBe('obj: { a: 1, b: 99, c: 3 }');
    });

    it('should preserve surrounding structure when modifying array items', async () => {
      const yaml = `list:
  - one
  -   two   # comment
  - three`;
      await fs.writeFile(tmpFile, yaml);
      await modifyYaml(tmpFile, 'list.1', 'updated');
      const content = await fs.readFile(tmpFile, 'utf-8');
      expect(content).toBe(`list:
  - one
  -   updated   # comment
  - three`);
    });

    // Edge Case: Block Scalar replacement
    // If we replace a block scalar with a single line string, surgical splice should work
    // IF the range covers the whole block.
    it('should correctly replace block scalar with simple string', async () => {
      const yaml = `key: |
  line1
  line2`;
      await fs.writeFile(tmpFile, yaml);
      await modifyYaml(tmpFile, 'key', 'simple');
      const content = await fs.readFile(tmpFile, 'utf-8');
      // Start point of range for Block Scalar typically includes the header?
      // If range is just content, we might get "key: | simple" which is valid but weird?
      // Or "key: simple" if we replace the node.
      // Let's see what happens. Ideally we want "key: simple" or valid YAML.
      const { parse } = await import('yaml');
      const doc = parse(content);
      expect(doc.key).toBe('simple');
    });
  });

  it('should modify a simple key', async () => {
    await fs.writeFile(tmpFile, 'key: old_value\n');
    const old = await modifyYaml(tmpFile, 'key', 'new_value');
    expect(old).toBe('old_value');
    const content = await fs.readFile(tmpFile, 'utf-8');
    expect(content).toContain('key: new_value');
  });

  it('should preserve comments', async () => {
    await fs.writeFile(tmpFile, 'key: value # This is a comment\nother: value\n');
    await modifyYaml(tmpFile, 'key', 'new_value');
    const content = await fs.readFile(tmpFile, 'utf-8');
    expect(content).toMatch(/key: "?new_value"? # This is a comment/);
    expect(content).toContain('other: value');
  });

  it('should handle nested keys', async () => {
    await fs.writeFile(tmpFile, 'parent:\n  child: value\n');
    await modifyYaml(tmpFile, 'parent.child', 'new_value');
    const content = await fs.readFile(tmpFile, 'utf-8');
    expect(content).toContain('child: new_value');
  });

  it('should infer boolean types', async () => {
    await fs.writeFile(tmpFile, 'enabled: false\n');
    await modifyYaml(tmpFile, 'enabled', 'true');
    const content = await fs.readFile(tmpFile, 'utf-8');
    expect(content).toContain('enabled: true');
    const { parse } = await import('yaml');
    const doc = parse(content);
    expect(typeof doc.enabled).toBe('boolean');
    expect(doc.enabled).toBe(true);
  });

  it('should infer number types', async () => {
    await fs.writeFile(tmpFile, 'count: 0\n');
    await modifyYaml(tmpFile, 'count', '42');
    const content = await fs.readFile(tmpFile, 'utf-8');
    expect(content).toContain('count: 42');
    const { parse } = await import('yaml');
    const doc = parse(content);
    expect(typeof doc.count).toBe('number');
    expect(doc.count).toBe(42);
  });

  it('should handle array index access', async () => {
    await fs.writeFile(tmpFile, 'items:\n  - one\n  - two\n');
    await modifyYaml(tmpFile, 'items.1', 'three');
    const content = await fs.readFile(tmpFile, 'utf-8');
    const { parse } = await import('yaml');
    const doc = parse(content);
    expect(doc.items[1]).toBe('three');
    expect(doc.items[0]).toBe('one');
  });

  it('should handle special characters requiring quotes', async () => {
    await fs.writeFile(tmpFile, 'key: value\n');
    await modifyYaml(tmpFile, 'key', 'hello: world');
    const content = await fs.readFile(tmpFile, 'utf-8');
    // We verify correctness by parsing. 'yaml' library might or might not quote if it's safe.
    const { parse } = await import('yaml');
    const doc = parse(content);
    expect(doc.key).toBe('hello: world');
  });

  it('should handle multiline strings', async () => {
    await fs.writeFile(tmpFile, 'description: short\n');
    const multiline = 'line1\nline2';
    await modifyYaml(tmpFile, 'description', multiline);
    const content = await fs.readFile(tmpFile, 'utf-8');
    const { parse } = await import('yaml');
    const doc = parse(content);
    expect(doc.description).toBe(multiline);
  });

  it('should handle explicit null', async () => {
    await fs.writeFile(tmpFile, 'key: value\n');
    await modifyYaml(tmpFile, 'key', 'null');
    const content = await fs.readFile(tmpFile, 'utf-8');
    const { parse } = await import('yaml');
    const doc = parse(content);
    expect(doc.key).toBeNull();
  });

  it('should throw error if key not found', async () => {
    await fs.writeFile(tmpFile, 'key: value\n');
    await expect(modifyYaml(tmpFile, 'missing.key', 'val')).rejects.toThrow(/not found/);
  });

  it('should throw error if file not found', async () => {
    await expect(modifyYaml(path.join(tmpDir, 'nonexistent.yaml'), 'key', 'val')).rejects.toThrow(/File not found/);
  });

  describe('Primitive Types Integration', () => {
    it('should correctly handle integers (pos, neg, zero)', async () => {
      await fs.writeFile(tmpFile, 'val: old\n');
      const cases = ['0', '42', '-100', '9007199254740991']; // Max Safe Int
      for (const val of cases) {
        await modifyYaml(tmpFile, 'val', val);
        const content = await fs.readFile(tmpFile, 'utf-8');
        const { parse } = await import('yaml');
        const doc = parse(content);
        expect(doc.val).toBe(Number(val));
        expect(typeof doc.val).toBe('number');
      }
    });

    it('should correctly handle floats', async () => {
      await fs.writeFile(tmpFile, 'val: old\n');
      const cases = ['0.5', '-123.456', '3.14159'];
      for (const val of cases) {
        await modifyYaml(tmpFile, 'val', val);
        const content = await fs.readFile(tmpFile, 'utf-8');
        const { parse } = await import('yaml');
        const doc = parse(content);
        expect(doc.val).toBe(Number(val));
        expect(typeof doc.val).toBe('number');
      }
    });

    it('should correctly handle booleans', async () => {
      await fs.writeFile(tmpFile, 'val: old\n');

      await modifyYaml(tmpFile, 'val', 'true');
      const c1 = await fs.readFile(tmpFile, 'utf-8');
      expect((await import('yaml')).parse(c1).val).toBe(true);

      await modifyYaml(tmpFile, 'val', 'false');
      const c2 = await fs.readFile(tmpFile, 'utf-8');
      expect((await import('yaml')).parse(c2).val).toBe(false);
    });

    it('should correctly handle null', async () => {
      await fs.writeFile(tmpFile, 'val: old\n');
      await modifyYaml(tmpFile, 'val', 'null');
      const content = await fs.readFile(tmpFile, 'utf-8');
      expect((await import('yaml')).parse(content).val).toBeNull();
    });

    it('should handle forced strings (quoted input)', async () => {
      // If user provides '"123"', inference should fail regex, treat as string '"123"'.
      // generateYamlString('"123"') -> '"123"' (quotes might vary but content string).
      await fs.writeFile(tmpFile, 'val: old\n');
      await modifyYaml(tmpFile, 'val', '"123"'); // Input is literally the string "123" including quotes
      const content = await fs.readFile(tmpFile, 'utf-8');
      // YAML: val: "123"
      expect((await import('yaml')).parse(content).val).toBe('"123"');
    });

    it('should handle empty and whitespace strings', async () => {
      await fs.writeFile(tmpFile, 'val: old\n');

      await modifyYaml(tmpFile, 'val', '');
      let doc = (await import('yaml')).parse(await fs.readFile(tmpFile, 'utf-8'));
      expect(doc.val).toBe('');

      await modifyYaml(tmpFile, 'val', '   ');
      doc = (await import('yaml')).parse(await fs.readFile(tmpFile, 'utf-8'));
      expect(doc.val).toBe('   ');
    });
  });
});

describe('inferValueType', () => {
  it('should infer integers', () => {
    expect(inferValueType('123')).toBe(123);
    expect(inferValueType('-10')).toBe(-10);
  });

  it('should infer floats, hex, octal, infinity, and NaN', () => {
    expect(inferValueType('12.34')).toBe(12.34);
    expect(inferValueType('-0.5')).toBe(-0.5);
    expect(inferValueType('1e10')).toBe(1e10);
    expect(inferValueType('-1.5E-5')).toBe(-1.5e-5);
    expect(inferValueType('0xFF')).toBe(255);
    expect(inferValueType('-0x1')).toBe(-1);
    expect(inferValueType('0o777')).toBe(511);
    expect(inferValueType('.inf')).toBe(Infinity);
    expect(inferValueType('-.inf')).toBe(-Infinity);
    expect(inferValueType('.nan')).toBeNaN();
  });

  it('should infer booleans', () => {
    expect(inferValueType('true')).toBe(true);
    expect(inferValueType('false')).toBe(false);
  });

  it('should infer null', () => {
    expect(inferValueType('null')).toBe(null);
  });

  it('should keep other strings as is', () => {
    expect(inferValueType('hello')).toBe('hello');
    expect(inferValueType('123a')).toBe('123a');
    expect(inferValueType('0123')).toBe(123); // Standard JS Number('0123') is 123. If checking for OCTAL, regex might differ? Regex `^\d+` Matches 0123.
    // Wait, yaml 1.2 doesn't octal with leading 0 usually?
    // JS Number('0123') -> 123.
    // If user expected string '0123', strict logic might be needed, but current logic is Number().
  });
});

describe('generateYamlString', () => {
  it('should generate unquoted simple strings', () => {
    expect(generateYamlString('simple')).toBe('simple');
  });

  it('should quote special characters', () => {
    expect(generateYamlString('%')).toBe('"%"');
    expect(generateYamlString('hello: world')).toBe('"hello: world"');
    // Wait, existing check `key: hello: world` failure caused us to implement this.
    // Let's verify what `yaml` produces for dummy key.
    // dummy: hello: world -> valid?
  });

  it('should quote empty string', () => {
    expect(generateYamlString('')).toBe('""');
  });

  it('should quote whitespace only string', () => {
    expect(generateYamlString(' ')).toBe('" "');
  });

  it('should handle boolean/numbers', () => {
    expect(generateYamlString(true)).toBe('true');
    expect(generateYamlString(123)).toBe('123');
  });
});

describe('formatValue', () => {
  it('should format null/undefined', () => {
    expect(formatValue(null)).toBe('null');
    expect(formatValue(undefined)).toBe('undefined');
  });

  it('should format primitives', () => {
    expect(formatValue('str')).toBe('str');
    expect(formatValue(123)).toBe('123');
    expect(formatValue(true)).toBe('true');
  });

  it('should json stringify objects', () => {
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });

  it('should handle circular references safely', () => {
    const o: any = {};
    o.self = o;
    // JSON.stringify throws, fallback to String(o) -> [object Object]
    expect(formatValue(o)).toBe('[object Object]');
  });
});
