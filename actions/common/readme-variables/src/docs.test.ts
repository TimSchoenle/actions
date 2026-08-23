import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildDocsIndex, summarise } from './docs.js';

describe('summarise', () => {
  it('takes the first heading as the title and the first paragraph as the summary', () => {
    expect(summarise('# Deployment\n\nContainer, Helm and reproducible builds.\n', 'fallback')).toEqual({
      title: 'Deployment',
      summary: 'Container, Helm and reproducible builds.',
    });
  });

  it('falls back to the given title when the document has no heading', () => {
    expect(summarise('Just prose.\n', 'docs/notes.md')).toEqual({
      title: 'docs/notes.md',
      summary: 'Just prose.',
    });
  });

  it('keeps looking for prose past a section heading', () => {
    expect(summarise('# Title\n\n## Section\n\nThe prose.\n', 'x').summary).toBe('The prose.');
  });

  // Every generated file in the estate opens with a banner naming its template.
  it('skips an HTML comment banner', () => {
    expect(summarise('<!--\nGenerated from a template.\nDo not edit.\n-->\n# Title\n\nReal prose.\n', 'x')).toEqual({
      title: 'Title',
      summary: 'Real prose.',
    });
  });

  it('skips YAML front matter', () => {
    expect(summarise('---\ntitle: meta\n---\n\n# Real\n\nProse.\n', 'x')).toEqual({ title: 'Real', summary: 'Prose.' });
  });

  it.each([
    ['a backtick fence', '# T\n\n```\n# not a heading\n```\n\nProse.\n'],
    ['a tilde fence', '# T\n\n~~~\n# not a heading\n~~~\n\nProse.\n'],
  ])('does not read %s as prose or as a heading', (_label, source) => {
    expect(summarise(source, 'x')).toEqual({ title: 'T', summary: 'Prose.' });
  });

  it('strips inline markup, which carries no meaning inside a table cell', () => {
    expect(
      summarise('# T\n\nSee [the chart](https://example.test) and `just verify` and *emphasis*.\n', 'x').summary,
    ).toBe('See the chart and just verify and emphasis.');
  });

  it('closes an ATX heading that carries trailing hashes', () => {
    expect(summarise('## Title ##\n', 'x').title).toBe('Title');
  });

  it('truncates a long paragraph at a word boundary', () => {
    const summary = summarise(`# T\n\n${'word '.repeat(120)}\n`, 'x').summary;

    expect(summary.length).toBeLessThanOrEqual(201);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary).not.toMatch(/wor…$/);
  });

  it('reports an empty summary for a document with no prose', () => {
    expect(summarise('# Title\n', 'x')).toEqual({ title: 'Title', summary: '' });
  });
});

describe('buildDocsIndex', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'readme-docs-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  async function write(relative: string, contents: string): Promise<void> {
    const target = path.join(workspace, relative);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }

  it.each([
    ['a directory that does not exist', 'docs'],
    ['an empty docs-dir, which means no index was asked for', ''],
  ])('returns an empty index for %s', async (_label, docsDir) => {
    await expect(buildDocsIndex(workspace, docsDir)).resolves.toEqual([]);
  });

  it('returns an empty index when docs-dir names a file', async () => {
    await write('docs', 'not a directory');

    await expect(buildDocsIndex(workspace, 'docs')).resolves.toEqual([]);
  });

  it('indexes Markdown by its own heading and first paragraph', async () => {
    await write('docs/DEPLOYMENT.md', '# Deployment\n\nContainer, Helm and reproducible builds.\n');

    await expect(buildDocsIndex(workspace, 'docs')).resolves.toEqual([
      { path: 'docs/DEPLOYMENT.md', title: 'Deployment', summary: 'Container, Helm and reproducible builds.' },
    ]);
  });

  // A contract a reader follows a link to is part of what the directory holds.
  it('indexes a non-Markdown document by path, with no summary', async () => {
    await write('docs/config.contract.json', '{"terrace_contract":1}');

    await expect(buildDocsIndex(workspace, 'docs')).resolves.toEqual([
      { path: 'docs/config.contract.json', title: 'docs/config.contract.json', summary: '' },
    ]);
  });

  it('descends into subdirectories', async () => {
    await write('docs/contracts/api.json', '{}');
    await write('docs/ARCHITECTURE.md', '# Architecture\n');

    const index = await buildDocsIndex(workspace, 'docs');

    expect(index.map((entry) => entry.path)).toEqual(['docs/ARCHITECTURE.md', 'docs/contracts/api.json']);
  });

  // readdir order differs between platforms; an unsorted index re-renders the same rows reordered.
  it('orders entries deterministically', async () => {
    for (const name of ['zebra', 'alpha', 'middle']) {
      await write(`docs/${name}.md`, `# ${name}\n`);
    }

    const index = await buildDocsIndex(workspace, 'docs');

    expect(index.map((entry) => entry.title)).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('reports POSIX paths, so the same value renders on either OS', async () => {
    await write('docs/nested/deep/NOTE.md', '# Note\n');

    const [entry] = await buildDocsIndex(workspace, 'docs');

    expect(entry.path).toBe('docs/nested/deep/NOTE.md');
  });

  it('honours a docs-dir other than the default', async () => {
    await write('documentation/GUIDE.md', '# Guide\n\nHow to.\n');

    await expect(buildDocsIndex(workspace, 'documentation')).resolves.toEqual([
      { path: 'documentation/GUIDE.md', title: 'Guide', summary: 'How to.' },
    ]);
  });
});
