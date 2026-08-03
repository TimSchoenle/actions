import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveWithinWorkspace, UnsafePathError, workspaceRoot } from './workspace-path.js';

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
