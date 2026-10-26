import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describePatch, serializeMetadata } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ArtifactContentError, readPatchArtifact, readRegularFile } from './artifact.js';

const SHA = 'a'.repeat(40);
const PATCH = Buffer.from('diff --git a/x b/x\n');

let root: string;
let directory: string;

async function lay(files: Record<string, string | Buffer>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(directory, name), contents);
  }
}

function metadataFor(patch: Buffer): string {
  return serializeMetadata(describePatch(SHA, patch));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'commit-patch-artifact-'));
  directory = path.join(root, 'download');
  await mkdir(directory);
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('readPatchArtifact', () => {
  it('returns the metadata and the patch path of a well-formed artifact', async () => {
    await lay({ 'changes.patch': PATCH, 'metadata.json': metadataFor(PATCH) });

    await expect(readPatchArtifact(directory, 1024)).resolves.toEqual({
      metadata: describePatch(SHA, PATCH),
      patchPath: path.join(directory, 'changes.patch'),
    });
  });

  it('accepts an empty patch', async () => {
    await lay({ 'changes.patch': '', 'metadata.json': metadataFor(Buffer.alloc(0)) });

    await expect(readPatchArtifact(directory, 1024)).resolves.toMatchObject({ metadata: { hasChanges: false } });
  });

  it('fails when nothing was downloaded', async () => {
    await expect(readPatchArtifact(path.join(root, 'missing'), 1024)).rejects.toThrow(/nothing was downloaded/);
  });

  it('passes on a failure to list the directory other than its absence', async () => {
    const file = path.join(root, 'not-a-directory');
    await writeFile(file, '');

    const failure = readPatchArtifact(file, 1024);

    await expect(failure).rejects.toMatchObject({ code: 'ENOTDIR' });
    await expect(failure).rejects.not.toBeInstanceOf(ArtifactContentError);
  });

  it.each([
    ['an empty directory', {}],
    ['a missing patch', { 'metadata.json': '{}' }],
    ['an extra file', { 'changes.patch': PATCH, 'metadata.json': '{}', 'extra.sh': 'x' }],
  ])('refuses %s', async (_name, files) => {
    await lay(files);

    await expect(readPatchArtifact(directory, 1024)).rejects.toThrow(
      /expected exactly changes.patch and metadata.json/,
    );
  });

  it('refuses a patch that is a symbolic link, without reading its target', async () => {
    const secret = path.join(root, 'secret');
    await writeFile(secret, PATCH);
    await symlink(secret, path.join(directory, 'changes.patch'));
    await lay({ 'metadata.json': metadataFor(PATCH) });

    await expect(readPatchArtifact(directory, 1024)).rejects.toThrow('changes.patch is a symbolic link');
  });

  it('refuses metadata that is a directory', async () => {
    await mkdir(path.join(directory, 'metadata.json'));
    await lay({ 'changes.patch': PATCH });

    await expect(readPatchArtifact(directory, 1024)).rejects.toThrow(/metadata.json is not a regular file|EISDIR/);
  });

  it('refuses a patch above max_patch_bytes before reading it', async () => {
    await lay({ 'changes.patch': PATCH, 'metadata.json': metadataFor(PATCH) });

    await expect(readPatchArtifact(directory, 4)).rejects.toThrow(/above max_patch_bytes \(4\)/);
  });

  it('refuses oversized metadata before parsing it', async () => {
    await lay({ 'changes.patch': PATCH, 'metadata.json': ' '.repeat(5000) });

    await expect(readPatchArtifact(directory, 1024)).rejects.toThrow(/above the metadata limit/);
  });

  it('refuses a patch whose size differs from the metadata', async () => {
    await lay({ 'changes.patch': Buffer.concat([PATCH, Buffer.from('+more\n')]), 'metadata.json': metadataFor(PATCH) });

    await expect(readPatchArtifact(directory, 1024)).rejects.toThrow(/records/);
  });

  it('refuses a patch whose digest differs from the metadata', async () => {
    const swapped = Buffer.from(PATCH.toString('utf8').replace('x', 'y'));
    await lay({ 'changes.patch': swapped, 'metadata.json': metadataFor(PATCH) });

    await expect(readPatchArtifact(directory, 1024)).rejects.toThrow(/SHA-256/);
  });

  it('refuses malformed metadata', async () => {
    await lay({ 'changes.patch': PATCH, 'metadata.json': '{"version":1}' });

    await expect(readPatchArtifact(directory, 1024)).rejects.toThrow(/exactly the keys/);
  });

  it('uses ArtifactContentError for its own findings', async () => {
    await expect(readPatchArtifact(directory, 1024)).rejects.toBeInstanceOf(ArtifactContentError);
  });
});

describe('readRegularFile', () => {
  it('passes on an open failure that is not a symbolic link', async () => {
    const failure = readRegularFile(path.join(directory, 'vanished.json'), 1024, 'the limit');

    await expect(failure).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(failure).rejects.not.toBeInstanceOf(ArtifactContentError);
  });
});
