import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TemplateNotFoundError } from './errors.js';
import { normalizeSource, readTemplateSource } from './template-file.js';

describe('normalizeSource', () => {
  it('leaves LF-only content untouched', () => {
    expect(normalizeSource('a\nb\n')).toBe('a\nb\n');
  });

  it.each([
    ['CRLF', 'a\r\nb\r\n'],
    ['CR', 'a\rb\r'],
    ['mixed', 'a\r\nb\rc\n'],
  ])('normalizes %s line endings to LF', (_label, source) => {
    expect(normalizeSource(source)).not.toMatch(/\r/);
  });

  it('does not collapse a CRLF into two newlines', () => {
    expect(normalizeSource('a\r\nb')).toBe('a\nb');
  });

  it('strips a leading byte order mark', () => {
    expect(normalizeSource('﻿# Title')).toBe('# Title');
  });

  it('leaves a byte order mark that is not leading alone', () => {
    expect(normalizeSource('a﻿b')).toBe('a﻿b');
  });
});

describe('readTemplateSource', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'render-template-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads a file as normalized text', async () => {
    const file = path.join(directory, 'template.hbs');
    await writeFile(file, '﻿a\r\nb\r\n', 'utf8');

    expect(await readTemplateSource(file)).toBe('a\nb\n');
  });

  it('reports a missing file with its path', async () => {
    const file = path.join(directory, 'absent.hbs');

    await expect(readTemplateSource(file)).rejects.toThrow(TemplateNotFoundError);
    await expect(readTemplateSource(file)).rejects.toThrow(new RegExp(file.replaceAll('\\', '\\\\')));
  });

  // A bare readFile reports this as EISDIR, which says nothing about which input was wrong.
  it('reports a directory as a missing template rather than a raw errno', async () => {
    await expect(readTemplateSource(directory)).rejects.toThrow(TemplateNotFoundError);
  });
});
