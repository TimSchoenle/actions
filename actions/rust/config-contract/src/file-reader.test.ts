import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileReader, isDirectory } from './file-reader.js';

const read = createFileReader();

describe('createFileReader', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'config-contract-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads a file as UTF-8', async () => {
    await writeFile(path.join(directory, 'contract.json'), '{"terrace_contract":1}', 'utf8');

    await expect(read(path.join(directory, 'contract.json'))).resolves.toBe('{"terrace_contract":1}');
  });

  // Three of the four checks ask "is the right thing at this path", so a missing file is a verdict
  // they report rather than an exception they propagate.
  it('reports a missing file as absent', async () => {
    await expect(read(path.join(directory, 'absent'))).resolves.toBeUndefined();
  });

  it('reports a path whose parent is a file as absent', async () => {
    await writeFile(path.join(directory, 'file'), 'x', 'utf8');

    await expect(read(path.join(directory, 'file', 'child'))).resolves.toBeUndefined();
  });

  // `docker cp` given a directory writes a directory. Reading it back has to be an answer, not a
  // crash, or the embedded-contract check reports a runtime error where it means "not a contract".
  it('reports a directory as absent', async () => {
    await mkdir(path.join(directory, 'nested'));

    await expect(read(path.join(directory, 'nested'))).resolves.toBeUndefined();
  });

  describe('isDirectory', () => {
    it('accepts a directory', async () => {
      await mkdir(path.join(directory, 'crate'));

      await expect(isDirectory(path.join(directory, 'crate'))).resolves.toBe(true);
    });

    it.each([
      { name: 'a file', create: async (target: string) => writeFile(target, 'x', 'utf8') },
      { name: 'nothing at all', create: async () => undefined },
    ])('refuses $name', async ({ create }) => {
      const target = path.join(directory, 'target');

      await create(target);

      await expect(isDirectory(target)).resolves.toBe(false);
    });
  });

  // An unreadable file means the check did not run, and an unrun check must not read as a clean one.
  it.runIf(process.platform !== 'win32')('propagates a read it was not allowed to make', async () => {
    const secret = path.join(directory, 'secret');

    await writeFile(secret, 'x', 'utf8');
    await chmod(secret, 0o000);

    await expect(read(secret)).rejects.toThrow();
  });
});
