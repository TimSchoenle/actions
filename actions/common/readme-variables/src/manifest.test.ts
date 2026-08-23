import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ManifestNotFoundError, ManifestUnreadableError } from './errors.js';
import { detectManifest, MANIFEST_CANDIDATES, readManifest, readerFor } from './manifest.js';

describe('readerFor', () => {
  it.each(MANIFEST_CANDIDATES)('claims %s', (name) => {
    expect(readerFor(name)).toBeTypeOf('function');
  });

  it('claims a manifest in a subdirectory by its basename', () => {
    expect(readerFor('charts/portfolio/Chart.yaml')).toBeTypeOf('function');
  });

  it('reads a Windows separator, so the same input works on either checkout', () => {
    expect(readerFor('charts\\portfolio\\Chart.yaml')).toBeTypeOf('function');
  });

  it.each([
    ['a file it has no reader for', 'pyproject.toml'],
    ['a lookalike suffix', 'not-Cargo.toml.bak'],
    ['a directory-shaped path', 'Cargo.toml/'],
  ])('does not claim %s', (_label, value) => {
    expect(readerFor(value)).toBeUndefined();
  });
});

describe('detectManifest', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'readme-manifest-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  const write = (name: string, contents: string) => writeFile(path.join(workspace, name), contents, 'utf8');

  it.each(MANIFEST_CANDIDATES)('finds %s', async (name) => {
    await write(name, '');

    await expect(detectManifest(workspace)).resolves.toBe(name);
  });

  // A Rust service whose package.json exists only to pin a CSS toolchain describes nothing.
  it('prefers Cargo.toml over a package.json beside it', async () => {
    await write('package.json', '{}');
    await write('Cargo.toml', '');

    await expect(detectManifest(workspace)).resolves.toBe('Cargo.toml');
  });

  it('does not descend into subdirectories', async () => {
    await mkdtemp(path.join(workspace, 'crates-'));

    await expect(detectManifest(workspace)).rejects.toThrow(ManifestNotFoundError);
  });

  it('names every candidate it looked for, and how to override', async () => {
    await expect(detectManifest(workspace)).rejects.toThrow(/Cargo\.toml.*package\.json.*Chart\.yaml/);
    await expect(detectManifest(workspace)).rejects.toThrow(/pass 'manifest' explicitly/);
  });
});

describe('readManifest', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'readme-read-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('dispatches to the reader its basename names', async () => {
    const file = path.join(workspace, 'Cargo.toml');

    await writeFile(file, '[package]\nname = "x"\nversion = "1.2.3"\n', 'utf8');

    await expect(readManifest(file, 'Cargo.toml')).resolves.toMatchObject({ kind: 'cargo', version: '1.2.3' });
  });

  it('reports the path as the caller wrote it, not as it resolved', async () => {
    const file = path.join(workspace, 'Cargo.toml');

    await writeFile(file, '[package]\nname = "x"\n', 'utf8');

    await expect(readManifest(file, 'apps/web/Cargo.toml')).rejects.toThrow(/^apps\/web\/Cargo\.toml:/);
  });

  it('refuses a file it has no reader for, rather than sniffing its contents', async () => {
    const file = path.join(workspace, 'pyproject.toml');

    await writeFile(file, '[project]\nversion = "1.0.0"\n', 'utf8');

    await expect(readManifest(file, 'pyproject.toml')).rejects.toThrow(ManifestUnreadableError);
  });

  it('reports an unreadable file with its path', async () => {
    await expect(readManifest(path.join(workspace, 'Cargo.toml'), 'Cargo.toml')).rejects.toThrow(
      /^Cargo\.toml: manifest not found or not readable\.$/,
    );
  });
});
