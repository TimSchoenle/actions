import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  OutputDriftError,
  PartialsDirectoryNotFoundError,
  TemplateNotFoundError,
  TemplateRenderError,
  UnsafeVariableKeyError,
  VariablesParseError,
} from './errors.js';
import { generateFile } from './generate.js';

import type { GenerateRequest } from './generate.js';

/**
 * End-to-end over the real filesystem, with only the runner absent.
 *
 * The units are covered individually elsewhere; what this file is for is the wiring between them —
 * the order operations happen in, and what is left on disk when one of them fails.
 */
describe('generateFile', () => {
  let directory: string;
  let templatePath: string;
  let outputPath: string;

  function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
    return {
      templatePath,
      outputPath,
      variables: '{}',
      partialsDir: '',
      strict: true,
      escapeHtml: false,
      check: false,
      ...overrides,
    };
  }

  async function writeTemplate(source: string): Promise<void> {
    await writeFile(templatePath, source, 'utf8');
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'render-generate-'));
    templatePath = path.join(directory, 'README.hbs');
    outputPath = path.join(directory, 'README.md');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('renders a template to the output file', async () => {
    await writeTemplate('# {{ title }}\n');

    const result = await generateFile(request({ variables: '{"title":"Actions"}' }));

    expect(result.changed).toBe(true);
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('# Actions\n');
  });

  it('renders a README table, the case this exists for', async () => {
    await writeTemplate(
      '| Action | Description |\n| --- | --- |\n{{#each (sortBy actions "name")}}| `{{ name }}` | {{ mdCell description }} |\n{{/each}}',
    );

    await generateFile(
      request({
        variables: JSON.stringify({
          actions: [
            { name: 'read-yaml', description: 'Read a value | by dot path' },
            { name: 'clippy', description: 'Lint Rust' },
          ],
        }),
      }),
    );

    await expect(readFile(outputPath, 'utf8')).resolves.toBe(
      '| Action | Description |\n| --- | --- |\n| `clippy` | Lint Rust |\n| `read-yaml` | Read a value \\| by dot path |\n',
    );
  });

  it('reports how many partials it registered', async () => {
    const partialsDir = path.join(directory, 'partials');
    await mkdir(partialsDir, { recursive: true });
    await writeFile(path.join(partialsDir, 'row.hbs'), '{{ name }}', 'utf8');
    await writeFile(path.join(partialsDir, 'head.hbs'), 'H', 'utf8');
    await writeTemplate('{{> head }}{{> row }}');

    const result = await generateFile(request({ partialsDir, variables: '{"name":"x"}' }));

    expect(result.partialCount).toBe(2);
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('Hx');
  });

  // The property the drift check depends on: unchanged inputs must produce byte-identical output.
  it('is idempotent across repeated runs', async () => {
    await writeTemplate('{{#each (sort tags)}}{{ this }}\n{{/each}}');
    const variables = '{"tags":["b","a","c"]}';

    const first = await generateFile(request({ variables }));
    const second = await generateFile(request({ variables }));

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.checksum).toBe(first.checksum);
  });

  it('writes to a nested output path that does not exist yet', async () => {
    await writeTemplate('x');
    const nested = path.join(directory, 'docs', 'api', 'README.md');

    await generateFile(request({ outputPath: nested }));

    await expect(readFile(nested, 'utf8')).resolves.toBe('x');
  });

  describe('check mode', () => {
    it('passes when the committed output is current', async () => {
      await writeTemplate('# {{ title }}\n');
      const variables = '{"title":"Actions"}';
      await generateFile(request({ variables }));

      await expect(generateFile(request({ variables, check: true }))).resolves.toMatchObject({ changed: false });
    });

    it('fails when the committed output is stale', async () => {
      await writeTemplate('# {{ title }}\n');
      await generateFile(request({ variables: '{"title":"Old"}' }));

      await expect(generateFile(request({ variables: '{"title":"New"}', check: true }))).rejects.toThrow(
        OutputDriftError,
      );
    });

    it('leaves the stale file in place', async () => {
      await writeTemplate('# {{ title }}\n');
      await generateFile(request({ variables: '{"title":"Old"}' }));

      await expect(generateFile(request({ variables: '{"title":"New"}', check: true }))).rejects.toThrow();
      await expect(readFile(outputPath, 'utf8')).resolves.toBe('# Old\n');
    });
  });

  describe('failures leave no output behind', () => {
    it.each([
      ['malformed variables', { variables: '{oops}' }, VariablesParseError],
      ['a prototype-reaching key', { variables: '{"constructor":1}' }, UnsafeVariableKeyError],
      ['a missing partials directory', { partialsDir: 'nope' }, PartialsDirectoryNotFoundError],
    ])('rejects %s before touching the filesystem', async (_label, overrides, expected) => {
      await writeTemplate('x');

      await expect(generateFile(request(overrides))).rejects.toThrow(expected);
      await expect(stat(outputPath)).rejects.toThrow();
    });

    it('rejects a missing template', async () => {
      await expect(generateFile(request())).rejects.toThrow(TemplateNotFoundError);
      await expect(stat(outputPath)).rejects.toThrow();
    });

    it('rejects an undefined reference under strict mode', async () => {
      await writeTemplate('{{ missing }}');

      await expect(generateFile(request())).rejects.toThrow(TemplateRenderError);
      await expect(stat(outputPath)).rejects.toThrow();
    });

    it('renders an undefined reference as empty when strict mode is off', async () => {
      await writeTemplate('[{{ missing }}]');

      await generateFile(request({ strict: false }));

      await expect(readFile(outputPath, 'utf8')).resolves.toBe('[]');
    });
  });

  it('normalizes the line endings of a CRLF template', async () => {
    await writeFile(templatePath, '# {{ title }}\r\n\r\nBody\r\n', 'utf8');

    await generateFile(request({ variables: '{"title":"Actions"}' }));

    await expect(readFile(outputPath, 'utf8')).resolves.toBe('# Actions\n\nBody\n');
  });
});
