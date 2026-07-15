import { describe, expect, it } from 'vitest';

import { classifyChanges, parseChangedPaths } from './changes.js';

import type { WorkspaceReader } from './changes.js';

/** Builds a `git status --porcelain -z` payload from `XY path` records. */
function porcelain(...records: string[]): string {
  return records.map((record) => `${record}\0`).join('');
}

describe('parseChangedPaths', () => {
  it('extracts the path from each status record, dropping the status characters', () => {
    const output = porcelain(' M src/a.ts', '?? new.txt', ' D gone.ts', 'A  staged.ts');

    expect(parseChangedPaths(output)).toEqual(['src/a.ts', 'new.txt', 'gone.ts', 'staged.ts']);
  });

  it('returns nothing for an empty (clean) tree', () => {
    expect(parseChangedPaths('')).toEqual([]);
  });

  it('preserves a path containing spaces, which -z keeps intact', () => {
    expect(parseChangedPaths(porcelain(' M my file.ts'))).toEqual(['my file.ts']);
  });

  it('de-duplicates a path that appears in more than one record', () => {
    expect(parseChangedPaths(porcelain(' M dup.ts', ' M dup.ts'))).toEqual(['dup.ts']);
  });

  it('skips a truncated record that carries no path', () => {
    expect(parseChangedPaths(porcelain(' M real.ts', 'XY'))).toEqual(['real.ts']);
  });
});

/** A workspace where the listed files exist with the given text content, and nothing else does. */
function fakeWorkspace(files: Record<string, string>): WorkspaceReader {
  return {
    exists: (path) => path in files,
    readBase64: (path) => Buffer.from(files[path], 'utf8').toString('base64'),
  };
}

describe('classifyChanges', () => {
  it('adds files that still exist and deletes files that are gone', () => {
    const workspace = fakeWorkspace({ 'kept.ts': 'hello', 'src/new.ts': 'world' });

    const changes = classifyChanges(['kept.ts', 'src/new.ts', 'removed.ts'], workspace);

    expect(changes.additions).toEqual([
      { contents: Buffer.from('hello').toString('base64'), path: 'kept.ts' },
      { contents: Buffer.from('world').toString('base64'), path: 'src/new.ts' },
    ]);
    expect(changes.deletions).toEqual([{ path: 'removed.ts' }]);
  });

  it('produces empty additions and deletions for no paths', () => {
    expect(classifyChanges([], fakeWorkspace({}))).toEqual({ additions: [], deletions: [] });
  });

  it('base64-encodes content so binary data survives the commit API', () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x80]);
    const workspace: WorkspaceReader = {
      exists: () => true,
      readBase64: () => bytes.toString('base64'),
    };

    const [addition] = classifyChanges(['logo.png'], workspace).additions;

    expect(Buffer.from(addition.contents, 'base64')).toEqual(bytes);
  });
});
