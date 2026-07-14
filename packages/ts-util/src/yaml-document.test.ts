import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadYaml, readYamlFile, splitKeyPath, YamlFileNotFoundError, YamlParseError } from './yaml-document.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'yaml-document-'));
}

describe('readYamlFile', () => {
  it('reports a missing path as undefined rather than throwing', async () => {
    await expect(readYamlFile(join(await tempDir(), 'absent.yaml'))).resolves.toBeUndefined();
  });

  // A directory is not a readable file. The `existsSync` gate this replaces reported one as present
  // and then failed on the read with a raw EISDIR, which reached the job log unexplained.
  it('reports a directory as undefined rather than throwing', async () => {
    await expect(readYamlFile(await tempDir())).resolves.toBeUndefined();
  });

  it('reads a file', async () => {
    const file = join(await tempDir(), 'c.yaml');
    await writeFile(file, 'a: 1\n', 'utf8');

    await expect(readYamlFile(file)).resolves.toBe('a: 1\n');
  });
});

describe('loadYaml', () => {
  const fileWith = (content: string) => async (): Promise<string | undefined> => content;

  it('parses the document and hands back the exact source', async () => {
    const { document, source } = await loadYaml('c.yaml', {}, fileWith('a: 1 # keep me\n'));

    expect(source).toBe('a: 1 # keep me\n');
    expect(document.getIn(['a'])).toBe(1);
  });

  it('rejects a path that is not a readable file', async () => {
    await expect(loadYaml('c.yaml', {}, async () => undefined)).rejects.toThrow(YamlFileNotFoundError);
    await expect(loadYaml('c.yaml', {}, async () => undefined)).rejects.toThrow('File not found: c.yaml');
  });

  it('rejects a file that does not parse', async () => {
    await expect(loadYaml('c.yaml', {}, fileWith('a: [1,\nb: 2\n'))).rejects.toThrow(YamlParseError);
  });
});

describe('splitKeyPath', () => {
  it('splits a dot-path into its keys', () => {
    expect(splitKeyPath('app.database.host')).toEqual(['app', 'database', 'host']);
    expect(splitKeyPath('a')).toEqual(['a']);
  });
});
