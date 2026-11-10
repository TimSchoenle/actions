import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheDir, cacheFile, extractTar, extractZip, find } from './tool-cache.js';

vi.mock('actions-util/core', () => ({ debug: vi.fn() }));

let root: string;
let env: Record<string, string>;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tool-cache-'));
  env = { RUNNER_TEMP: path.join(root, 'temp'), RUNNER_TOOL_CACHE: path.join(root, 'cache') };
  await mkdir(env.RUNNER_TEMP);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A directory holding an executable and a relative symlink to it. */
async function sampleTree(): Promise<string> {
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'bin'), { recursive: true });
  await writeFile(path.join(source, 'bin', 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  await symlink('tool', path.join(source, 'bin', 'alias'));

  return source;
}

describe('cacheDir and find', () => {
  it('copies the tree into <cache>/<tool>/<version>/<arch> and marks it complete', async () => {
    const cached = await cacheDir(await sampleTree(), 'terrace', '1.2.3', env);

    expect(cached).toBe(path.join(env.RUNNER_TOOL_CACHE, 'terrace', '1.2.3', os.arch()));
    expect(await readFile(path.join(cached, 'bin', 'tool'), 'utf8')).toBe('#!/bin/sh\n');
    expect(await readlink(path.join(cached, 'bin', 'alias'))).toBe('tool');
    expect(existsSync(`${cached}.complete`)).toBe(true);
    expect(find('terrace', '1.2.3', env)).toBe(cached);
    if (process.platform !== 'win32') {
      expect((await stat(path.join(cached, 'bin', 'tool'))).mode & 0o111).not.toBe(0);
    }
  });

  it('replaces whatever an earlier attempt left behind', async () => {
    const stale = path.join(env.RUNNER_TOOL_CACHE, 'terrace', '1.2.3', os.arch());
    await mkdir(stale, { recursive: true });
    await writeFile(path.join(stale, 'leftover'), '');

    await cacheDir(await sampleTree(), 'terrace', '1.2.3', env);

    expect(existsSync(path.join(stale, 'leftover'))).toBe(false);
  });

  it('refuses a source that is not a directory', async () => {
    const file = path.join(root, 'file');
    await writeFile(file, '');

    await expect(cacheDir(file, 'terrace', '1.2.3', env)).rejects.toThrow('sourceDir is not a directory');
  });

  it('finds nothing that is missing or was never marked complete', async () => {
    expect(find('terrace', '1.2.3', env)).toBe('');

    await mkdir(path.join(env.RUNNER_TOOL_CACHE, 'terrace', '9.9.9', os.arch()), { recursive: true });
    expect(find('terrace', '9.9.9', env)).toBe('');
  });

  it('takes only exact versions', () => {
    expect(() => find('terrace', '1.x', env)).toThrow('exact MAJOR.MINOR.PATCH');
    expect(() => find('', '1.2.3', env)).toThrow('toolName parameter is required');
  });

  it('needs RUNNER_TOOL_CACHE', () => {
    expect(() => find('terrace', '1.2.3', {})).toThrow('Expected RUNNER_TOOL_CACHE to be defined');
  });
});

describe('cacheFile', () => {
  it('copies one file into the cache under its new name', async () => {
    const source = path.join(root, 'cosign-linux-amd64');
    await writeFile(source, 'binary');

    const cached = await cacheFile(source, 'cosign', 'cosign', '2.4.1', env);

    expect(await readFile(path.join(cached, 'cosign'), 'utf8')).toBe('binary');
    expect(find('cosign', '2.4.1', env)).toBe(cached);
  });

  it('refuses a source that is not a file', async () => {
    await expect(cacheFile(root, 'x', 'cosign', '2.4.1', env)).rejects.toThrow('sourceFile is not a file');
  });
});

describe.skipIf(process.platform === 'win32')('extractTar', () => {
  it('extracts a gzipped tarball into a new directory under RUNNER_TEMP', async () => {
    const source = await sampleTree();
    const archive = path.join(root, 'archive.tar.gz');
    execFileSync('tar', ['czf', archive, '-C', source, '.']);

    const extracted = await extractTar(archive, env);

    expect(path.dirname(extracted)).toBe(env.RUNNER_TEMP);
    expect(await readFile(path.join(extracted, 'bin', 'tool'), 'utf8')).toBe('#!/bin/sh\n');
  });
});

describe.skipIf(process.platform === 'win32' || !hasUnzip())('extractZip', () => {
  it('extracts a zip archive into a new directory under RUNNER_TEMP', async () => {
    const source = await sampleTree();
    const archive = path.join(root, 'archive.zip');
    execFileSync('zip', ['-qr', archive, '.'], { cwd: source });

    const extracted = await extractZip(archive, env);

    expect(await readFile(path.join(extracted, 'bin', 'tool'), 'utf8')).toBe('#!/bin/sh\n');
  });
});

function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    execFileSync('zip', ['-v'], { stdio: 'ignore' });

    return true;
  } catch {
    return false;
  }
}
