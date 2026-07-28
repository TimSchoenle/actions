import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PartialsDirectoryNotFoundError } from './errors.js';
import { loadPartials, partialName } from './partials.js';

describe('partialName', () => {
  it('drops the extension', () => {
    expect(partialName('/root', path.join('/root', 'row.hbs'))).toBe('row');
  });

  it('keeps nesting, so a partials directory can be organized', () => {
    expect(partialName('/root', path.join('/root', 'tables', 'actions.hbs'))).toBe('tables/actions');
  });

  // A template addressing `{{> tables/actions }}` has to resolve on a Windows checkout too.
  it('normalizes separators to forward slashes', () => {
    expect(partialName('/root', path.join('/root', 'a', 'b', 'c.hbs'))).toBe('a/b/c');
  });
});

describe('loadPartials', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'render-partials-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    ['an empty path', ''],
    ['a whitespace-only path', '   '],
  ])('returns nothing for %s, which means no partials were declared', async (_label, input) => {
    await expect(loadPartials(input)).resolves.toEqual([]);
  });

  it('loads a flat directory', async () => {
    await writeFile(path.join(directory, 'row.hbs'), '| {{ name }} |', 'utf8');

    await expect(loadPartials(directory)).resolves.toEqual([
      { name: 'row', path: path.join(directory, 'row.hbs'), source: '| {{ name }} |' },
    ]);
  });

  it('loads nested directories recursively', async () => {
    await mkdir(path.join(directory, 'tables'), { recursive: true });
    await writeFile(path.join(directory, 'tables', 'actions.hbs'), 'a', 'utf8');
    await writeFile(path.join(directory, 'row.hbs'), 'r', 'utf8');

    const names = (await loadPartials(directory)).map((entry) => entry.name);

    expect(names).toEqual(['row', 'tables/actions']);
  });

  it('normalizes partial sources the same way it normalizes templates', async () => {
    await writeFile(path.join(directory, 'row.hbs'), '﻿a\r\nb', 'utf8');

    const [partial] = await loadPartials(directory);

    expect(partial.source).toBe('a\nb');
  });

  it('ignores files that are not partials', async () => {
    await writeFile(path.join(directory, 'row.hbs'), 'r', 'utf8');
    await writeFile(path.join(directory, 'notes.md'), 'x', 'utf8');
    await writeFile(path.join(directory, 'README'), 'x', 'utf8');

    const names = (await loadPartials(directory)).map((entry) => entry.name);

    expect(names).toEqual(['row']);
  });

  it('returns an empty list for a directory holding no partials', async () => {
    await expect(loadPartials(directory)).resolves.toEqual([]);
  });

  it('returns partials in a stable order regardless of filesystem enumeration', async () => {
    for (const name of ['c', 'a', 'b']) {
      await writeFile(path.join(directory, `${name}.hbs`), name, 'utf8');
    }

    expect((await loadPartials(directory)).map((entry) => entry.name)).toEqual(['a', 'b', 'c']);
  });

  describe('rejections', () => {
    // A typo here would otherwise render a template missing all its partials, which under strict
    // mode fails confusingly and under a stale output could pass.
    it('reports a directory that does not exist', async () => {
      await expect(loadPartials(path.join(directory, 'absent'))).rejects.toThrow(PartialsDirectoryNotFoundError);
    });

    it('reports a path that is a file rather than a directory', async () => {
      const file = path.join(directory, 'row.hbs');
      await writeFile(file, 'r', 'utf8');

      await expect(loadPartials(file)).rejects.toThrow(PartialsDirectoryNotFoundError);
    });
  });
});
