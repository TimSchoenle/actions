import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stringifyScalar, stringifyValue } from 'actions-common-ts-util';
import { readYaml, readYamlFile } from './read.js';
import { Scalar } from 'yaml';

import type { YamlFileReader } from './read.js';

const FILE = 'config.yaml';

/** Serves a single in-memory document, so no test needs a fixture on disk. */
function fileWith(content: string): YamlFileReader {
  return async (requested) => (requested === FILE ? content : undefined);
}

function read(content: string, key: string): Promise<string> {
  return readYaml(FILE, key, fileWith(content));
}

/**
 * Byte-for-byte the document that `.github/workflows/verify-action-common-read-yaml.yaml` writes
 * before invoking the action, including the indentation-only lines. The e2e matrix asserts against
 * it, so it is pinned here as well: a regression must fail in unit tests, not in CI.
 */
const E2E_DOCUMENT = `version: 1.0.0

# Application Metadata
app:
  name: test-app # inline comment
  debug: true

  # Database Configuration
  database:
    host: localhost
    port: 5432

  resources:
    limits:
      cpu: 500m
`;

describe('readYaml', () => {
  // The exact matrix of the e2e workflow.
  it.each([
    { desc: 'Root key', expected: '1.0.0', key: 'version' },
    { desc: 'Nested key', expected: 'test-app', key: 'app.name' },
    { desc: 'Deep nested key', expected: 'localhost', key: 'app.database.host' },
    { desc: 'Mixed type value (string)', expected: '500m', key: 'app.resources.limits.cpu' },
    { desc: 'Boolean value', expected: 'true', key: 'app.debug' },
  ])('reads $key as $expected ($desc)', async ({ expected, key }) => {
    await expect(read(E2E_DOCUMENT, key)).resolves.toBe(expected);
  });

  it('reads a number as the text it was written with', async () => {
    await expect(read(E2E_DOCUMENT, 'app.database.port')).resolves.toBe('5432');
  });

  describe('failures', () => {
    it('fails when the file does not exist', async () => {
      await expect(readYaml('missing.yaml', 'version', fileWith(E2E_DOCUMENT))).rejects.toThrow(
        'File not found: missing.yaml',
      );
    });

    it('fails when the key does not exist', async () => {
      await expect(read(E2E_DOCUMENT, 'app.missing')).rejects.toThrow(`Key 'app.missing' not found in ${FILE}`);
    });

    it('fails when the path traverses a scalar', async () => {
      await expect(read(E2E_DOCUMENT, 'version.major')).rejects.toThrow(`Key 'version.major' not found in ${FILE}`);
    });

    it('fails when the path traverses a missing intermediate node', async () => {
      await expect(read(E2E_DOCUMENT, 'app.cache.host')).rejects.toThrow(`Key 'app.cache.host' not found in ${FILE}`);
    });

    it('fails on an empty document', async () => {
      await expect(read('', 'version')).rejects.toThrow(`Key 'version' not found in ${FILE}`);
    });

    it('fails on malformed YAML', async () => {
      await expect(read('a:\n- b\n  c: [\n', 'a')).rejects.toThrow(/^YAML parse error: /);
    });

    // Dots always split; a key containing a literal dot is not addressable. Inherited from the `yq`
    // invocation this replaces and shared with `modify-yaml`.
    it('does not address a key that contains a dot', async () => {
      await expect(read('image.tag: v1\n', 'image.tag')).rejects.toThrow(/not found/);
    });
  });

  describe('scalars', () => {
    it.each([
      { desc: 'semantic version', expected: '1.0.0', yaml: 'value: 1.0.0' },
      { desc: 'quantity suffix', expected: '500m', yaml: 'value: 500m' },
      { desc: 'trailing zero float', expected: '1.0', yaml: 'value: 1.0' },
      { desc: 'exponent notation', expected: '1e3', yaml: 'value: 1e3' },
      { desc: 'hexadecimal', expected: '0x1F', yaml: 'value: 0x1F' },
      { desc: 'zero padded number', expected: '007', yaml: 'value: 007' },
      { desc: 'quoted number', expected: '1.0', yaml: 'value: "1.0"' },
      { desc: 'integer', expected: '42', yaml: 'value: 42' },
      { desc: 'boolean true', expected: 'true', yaml: 'value: true' },
      { desc: 'boolean false', expected: 'false', yaml: 'value: false' },
      { desc: 'empty string', expected: '', yaml: 'value: ""' },
      { desc: 'escaped characters', expected: 'a\tb', yaml: 'value: "a\\tb"' },
      { desc: 'single quoted', expected: 'hello world', yaml: "value: 'hello world'" },
    ])('emits $desc verbatim', async ({ expected, yaml }) => {
      await expect(read(yaml, 'value')).resolves.toBe(expected);
    });

    // The bash reported an explicit null as "key not found", because it could only compare yq's
    // printed output to the string `null`. Presence is now structural, so a key that exists with a
    // null value succeeds and yields the text `null` — the same text `modify-yaml` reports for it.
    it.each([
      { desc: 'explicit null', yaml: 'value: null' },
      { desc: 'tilde null', yaml: 'value: ~' },
      { desc: 'empty value', yaml: 'value:' },
    ])('reads $desc as the text null', async ({ yaml }) => {
      await expect(read(yaml, 'value')).resolves.toBe('null');
    });

    it('preserves the line breaks of a block scalar', async () => {
      await expect(read('value: |\n  line1\n  line2\n', 'value')).resolves.toBe('line1\nline2\n');
    });
  });

  describe('collections', () => {
    // yq printed non-scalar nodes as a YAML block. The bash could not deliver them (`echo
    // "value=$VALUE"` corrupts $GITHUB_OUTPUT for multi-line values); `core.setOutput` can.
    it('serializes a map at zero indentation, without a trailing newline', async () => {
      await expect(read(E2E_DOCUMENT, 'app.database')).resolves.toBe(['host: localhost', 'port: 5432'].join('\n'));
    });

    it('serializes a nested map', async () => {
      await expect(read(E2E_DOCUMENT, 'app.resources')).resolves.toBe(['limits:', '  cpu: 500m'].join('\n'));
    });

    // Comments inside the subtree belong to its nodes and survive. The comment above `database:`
    // belongs to that pair's key, so it appears when the parent map is read, not when `app.database`
    // is read on its own.
    it('keeps the comments that live inside the subtree', async () => {
      await expect(read(E2E_DOCUMENT, 'app')).resolves.toBe(
        [
          'name: test-app # inline comment',
          'debug: true',
          '',
          '# Database Configuration',
          'database:',
          '  host: localhost',
          '  port: 5432',
          '',
          'resources:',
          '  limits:',
          '    cpu: 500m',
        ].join('\n'),
      );
    });

    it('serializes a sequence as a YAML block', async () => {
      await expect(read('items:\n  - one\n  - two\n', 'items')).resolves.toBe(['- one', '- two'].join('\n'));
    });

    it('reads a sequence element by index', async () => {
      await expect(read('items:\n  - one\n  - two\n', 'items.1')).resolves.toBe('two');
    });

    it('serializes an empty collection', async () => {
      await expect(read('items: []\n', 'items')).resolves.toBe('[]');
    });
  });

  describe('aliases', () => {
    const document = 'defaults: &defaults\n  host: localhost\nname: &name app\nuse: *defaults\nref: *name\n';

    it('resolves an aliased scalar to its anchored value', async () => {
      await expect(read(document, 'ref')).resolves.toBe('app');
    });

    // The anchor exists only to be referenced from within the source document; it carries no meaning
    // in a fragment that stands alone.
    it('resolves an aliased map and drops the root anchor', async () => {
      await expect(read(document, 'use')).resolves.toBe('host: localhost');
    });

    it('leaves the document untouched, so a later read sees the anchor again', async () => {
      const reader = fileWith(document);

      await expect(readYaml(FILE, 'use', reader)).resolves.toBe('host: localhost');
      await expect(readYaml(FILE, 'defaults', reader)).resolves.toBe('host: localhost');
    });
  });
});

describe('stringifyValue', () => {
  it('renders a scalar that was constructed rather than parsed', () => {
    expect(stringifyValue(new Scalar('constructed'))).toBe('constructed');
  });

  it('renders a constructed number without a source', () => {
    expect(stringifyScalar(new Scalar(42))).toBe('42');
  });
});

describe('readYamlFile', () => {
  it('reports a missing path as undefined rather than throwing', async () => {
    await expect(readYamlFile(path.join(os.tmpdir(), 'read-yaml-does-not-exist.yaml'))).resolves.toBeUndefined();
  });

  // `[ -f "$FILE" ]` was false for a directory too, and the action failed with "File not found".
  it('reports a directory as undefined rather than throwing', async () => {
    await expect(readYamlFile(os.tmpdir())).resolves.toBeUndefined();
  });
});
