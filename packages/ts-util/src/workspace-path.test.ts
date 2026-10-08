import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveRealWithinWorkspace,
  resolveWithinWorkspace,
  UnsafePathError,
  workspaceRoot,
} from './workspace-path.js';

const WORKSPACE = path.resolve('/tmp/workspace');

function resolveIn(value: string): string {
  return resolveWithinWorkspace(value, WORKSPACE, 'output');
}

describe('resolveWithinWorkspace', () => {
  it.each([
    { name: 'a file at the root', value: 'README.md' },
    { name: 'a nested file', value: 'docs/generated/README.md' },
    { name: 'a path with a redundant segment', value: 'docs/./README.md' },
    { name: 'a directory', value: 'partials' },
    { name: 'a path with surrounding whitespace', value: '  README.md  ' },
  ])('accepts $name', ({ value }) => {
    expect(resolveIn(value)).toBe(path.resolve(WORKSPACE, value.trim()));
  });

  it.each([
    { name: 'an empty value', value: '', reason: /must not be empty/ },
    { name: 'whitespace only', value: '   ', reason: /must not be empty/ },
    { name: 'a parent walk', value: '../escaped.md', reason: /must not traverse upwards/ },
    { name: 'a parent walk mid-path', value: 'docs/../../escaped.md', reason: /must not traverse upwards/ },
    // Rejected although it lands back inside: a rule that has to be simulated to be understood is
    // one a reviewer cannot check by eye, and no legitimate workflow needs to write through `..`.
    { name: 'a parent walk that returns', value: 'docs/nested/../README.md', reason: /must not traverse upwards/ },
    { name: 'a backslash parent walk', value: 'docs\\..\\..\\escaped.md', reason: /must not traverse upwards/ },
    { name: 'a POSIX absolute path', value: '/etc/passwd', reason: /must be relative/ },
    { name: 'a Windows drive path', value: 'C:/Windows/win.ini', reason: /must be relative/ },
    { name: 'a lower-case drive path', value: 'c:\\Windows\\win.ini', reason: /must be relative/ },
    { name: 'a UNC path', value: '\\\\host\\share\\file', reason: /must be relative/ },
  ])('rejects $name', ({ value, reason }) => {
    expect(() => resolveIn(value)).toThrow(UnsafePathError);
    expect(() => resolveIn(value)).toThrow(reason);
  });

  it('names the input in every message, so a caller knows which path to fix', () => {
    expect(() => resolveWithinWorkspace('../x', WORKSPACE, 'partials-dir')).toThrow(/^partials-dir /);
  });

  it('quotes the offending value rather than interpolating it', () => {
    expect(() => resolveIn('/etc/passwd\n::error::forged')).toThrow(/"\/etc\/passwd\\n::error::forged"/);
  });

  // A Windows drive prefix is a relative directory name to a POSIX `resolve`, which would happily
  // place it under the workspace — the same input then means two different things per platform.
  it('rejects a drive path identically on either platform', () => {
    expect(() => resolveWithinWorkspace('C:/Windows', '/tmp/ws', 'template')).toThrow(UnsafePathError);
  });

  it('accepts the workspace root itself', () => {
    expect(resolveIn('.')).toBe(WORKSPACE);
  });
});

/** Probed, not assumed: Windows creates links only under developer mode or an elevated session. */
async function canSymlink(): Promise<boolean> {
  const probe = await mkdtemp(path.join(tmpdir(), 'ts-util-link-'));

  try {
    await symlink(path.join(probe, 'target'), path.join(probe, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
}

describe.runIf(await canSymlink())('resolveRealWithinWorkspace', () => {
  let base: string;
  let workspace: string;
  let outside: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'ts-util-real-'));
    workspace = path.join(base, 'workspace');
    outside = path.join(base, 'outside');
    await mkdir(path.join(workspace, 'docs'), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(workspace, 'docs', 'README.md'), 'inside\n');
    await writeFile(path.join(outside, 'secret'), 'outside\n');
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  function resolveReal(value: string): Promise<string> {
    return resolveRealWithinWorkspace(value, workspace, 'template');
  }

  it('accepts an ordinary file, and returns the path as written rather than as resolved', async () => {
    await expect(resolveReal('docs/README.md')).resolves.toBe(path.join(workspace, 'docs', 'README.md'));
  });

  it('accepts a path that does not exist yet, judged by the directory it would be created in', async () => {
    await expect(resolveReal('docs/new/deep/OUT.md')).resolves.toBe(path.join(workspace, 'docs/new/deep/OUT.md'));
  });

  it('follows a link that stays inside the workspace', async () => {
    await symlink(path.join(workspace, 'docs', 'README.md'), path.join(workspace, 'README.md'));

    await expect(resolveReal('README.md')).resolves.toBe(path.join(workspace, 'README.md'));
  });

  it('accepts a workspace that itself sits behind a link', async () => {
    const alias = path.join(base, 'alias');

    await symlink(workspace, alias, 'dir');

    await expect(resolveRealWithinWorkspace('docs/README.md', alias, 'template')).resolves.toBe(
      path.join(alias, 'docs', 'README.md'),
    );
  });

  it.each([
    { name: 'a file linked outside', link: 'README.hbs', target: 'secret', value: 'README.hbs' },
    { name: 'a directory linked outside', link: 'partials', target: '.', value: 'partials' },
    { name: 'a path beneath a directory linked outside', link: 'out', target: '.', value: 'out/README.md' },
    { name: 'a new file beneath a directory linked outside', link: 'out', target: '.', value: 'out/new/x.md' },
  ])('rejects $name', async ({ link, target, value }) => {
    await symlink(path.join(outside, target), path.join(workspace, link));

    await expect(resolveReal(value)).rejects.toThrow(UnsafePathError);
    await expect(resolveReal(value)).rejects.toThrow(
      /^template resolves outside the workspace through a symbolic link/,
    );
  });

  // `writeFile` through a dangling link creates its target, wherever that is.
  it('rejects a link to nothing, which a write would follow to create its target', async () => {
    await symlink(path.join(outside, 'not-yet'), path.join(workspace, 'OUT.md'));

    await expect(resolveReal('OUT.md')).rejects.toThrow(/symbolic link to a path that does not exist/);
  });

  it('still applies the lexical rules first, naming the input', async () => {
    await expect(resolveReal('../outside/secret')).rejects.toThrow(/^template must not traverse upwards/);
  });
});

describe('workspaceRoot', () => {
  it('prefers GITHUB_WORKSPACE and falls back to the working directory', () => {
    const previous = process.env['GITHUB_WORKSPACE'];

    try {
      process.env['GITHUB_WORKSPACE'] = '/runner/work/repo/repo';
      expect(workspaceRoot()).toBe('/runner/work/repo/repo');

      delete process.env['GITHUB_WORKSPACE'];
      expect(workspaceRoot()).toBe(process.cwd());
    } finally {
      if (previous === undefined) {
        delete process.env['GITHUB_WORKSPACE'];
      } else {
        process.env['GITHUB_WORKSPACE'] = previous;
      }
    }
  });
});
