import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { classifyChanges } from './changes.js';
import { createWorkspace } from './workspace.js';

// Symbolic links need a privilege an unprivileged Windows session lacks; the runners these actions
// target are Linux and macOS.
const links = process.platform === 'win32' ? describe.skip : describe;

describe('createWorkspace', () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'commit-changes-workspace-'));
    root = path.join(base, 'repo');
    outside = path.join(base, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.txt'), 'INPUT_TOKEN=ghs_secret\n');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('reads a regular file as base64 bytes', () => {
    mkdirSync(path.join(root, 'dir'));
    writeFileSync(path.join(root, 'dir', 'a.bin'), Buffer.from([0, 255, 10]));
    const workspace = createWorkspace(root);

    expect(workspace.exists('dir/a.bin')).toBe(true);
    expect(workspace.readBase64('dir/a.bin')).toBe(Buffer.from([0, 255, 10]).toString('base64'));
  });

  it('reports a missing path, and a path below a missing directory, as gone', () => {
    const workspace = createWorkspace(root);

    expect(workspace.exists('gone.txt')).toBe(false);
    expect(workspace.exists('gone/a.txt')).toBe(false);
  });

  it('reports a path below what is now a file as gone', () => {
    writeFileSync(path.join(root, 'was-a-directory'), 'x');

    expect(createWorkspace(root).exists('was-a-directory/a.txt')).toBe(false);
  });

  it('refuses a directory', () => {
    mkdirSync(path.join(root, 'dir'));

    expect(() => createWorkspace(root).exists('dir')).toThrow(/not a regular file/);
  });

  links('symbolic links', () => {
    it('refuses a link to a file outside the working tree', () => {
      symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'env.txt'));

      expect(() => createWorkspace(root).exists('env.txt')).toThrow(/symbolic link/);
    });

    it('refuses a link to /proc/self/environ, the reproduction that committed the token', () => {
      symlinkSync('/proc/self/environ', path.join(root, 'env.txt'));

      expect(() => createWorkspace(root).exists('env.txt')).toThrow(/symbolic link/);
    });

    it('refuses a link to a file inside the working tree', () => {
      writeFileSync(path.join(root, 'real.txt'), 'real\n');
      symlinkSync(path.join(root, 'real.txt'), path.join(root, 'alias.txt'));

      expect(() => createWorkspace(root).exists('alias.txt')).toThrow(/symbolic link/);
    });

    it('refuses a dangling link instead of treating it as a deletion', () => {
      symlinkSync(path.join(outside, 'missing.txt'), path.join(root, 'dangling.txt'));

      expect(() => createWorkspace(root).exists('dangling.txt')).toThrow(/symbolic link/);
    });

    it('refuses a regular file reached through a linked directory that leaves the working tree', () => {
      symlinkSync(outside, path.join(root, 'linked'), 'dir');

      expect(() => createWorkspace(root).exists('linked/secret.txt')).toThrow(/outside the working tree/);
    });

    it('accepts a working tree that is itself reached through a link', () => {
      const alias = path.join(base, 'alias');
      symlinkSync(root, alias, 'dir');
      writeFileSync(path.join(root, 'a.txt'), 'a\n');
      const workspace = createWorkspace(alias);

      expect(workspace.exists('a.txt')).toBe(true);
      expect(workspace.readBase64('a.txt')).toBe(Buffer.from('a\n').toString('base64'));
    });

    it('refuses to read through a link swapped in after the existence check', () => {
      writeFileSync(path.join(root, 'swap.txt'), 'ok\n');
      const workspace = createWorkspace(root);
      expect(workspace.exists('swap.txt')).toBe(true);

      rmSync(path.join(root, 'swap.txt'));
      symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'swap.txt'));

      expect(() => workspace.readBase64('swap.txt')).toThrow(/ELOOP|symbolic link/);
    });

    it('fails the whole classification rather than committing the link target', () => {
      writeFileSync(path.join(root, 'ok.txt'), 'ok\n');
      symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'env.txt'));

      expect(() => classifyChanges(['ok.txt', 'env.txt'], createWorkspace(root))).toThrow(/symbolic link/);
    });
  });
});
