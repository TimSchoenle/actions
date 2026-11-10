import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rebuildStaleBundles, staleBuildDirs } from './autobuild.js';

let root: string;

/** Writes a file with a modification time `age` seconds in the past. */
function write(file: string, content: string, age: number): void {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  const time = new Date(Date.now() - age * 1000);
  utimesSync(target, time, time);
}

const NODE_ACTION = "runs:\n  using: 'node24'\n  main: 'dist/index.js'\n";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'autobuild-'));
  write('package.json', JSON.stringify({ name: 'root' }), 100);
  write('packages/util/package.json', JSON.stringify({ name: 'util' }), 100);
  write('packages/util/src/index.ts', 'util', 100);
  write('actions/a/fresh/action.yml', NODE_ACTION, 100);
  write('actions/a/fresh/package.json', JSON.stringify({ name: 'fresh', dependencies: { util: 'workspace:*' } }), 100);
  write('actions/a/fresh/dist/index.js', 'built', 10);
  write('actions/a/composite/action.yml', 'runs:\n  using: composite\n  steps: []\n', 100);
  write('scripts/build-action.ts', 'bundler', 100);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('staleBuildDirs', () => {
  it('finds nothing when every bundle is newer than its sources', () => {
    expect(staleBuildDirs(root)).toEqual([]);
  });

  it('finds an action whose own source changed after the build', () => {
    write('actions/a/fresh/src/action.ts', 'changed', 1);

    expect(staleBuildDirs(root)).toEqual(['actions/a/fresh']);
  });

  it('finds an action whose workspace dependency changed after the build', () => {
    write('packages/util/src/index.ts', 'changed', 1);

    expect(staleBuildDirs(root)).toEqual(['actions/a/fresh']);
  });

  it('finds every action when the shared bundler changed after the build', () => {
    write('scripts/build-action.ts', 'changed', 1);

    expect(staleBuildDirs(root)).toEqual(['actions/a/fresh']);
  });

  it('finds an action whose bundle is missing', () => {
    rmSync(path.join(root, 'actions/a/fresh/dist'), { recursive: true });

    expect(staleBuildDirs(root)).toEqual(['actions/a/fresh']);
  });

  it('ignores files under dist and node_modules', () => {
    write('actions/a/fresh/node_modules/dep/index.js', 'dep', 1);
    write('actions/a/fresh/dist/extra.js', 'extra', 1);

    expect(staleBuildDirs(root)).toEqual([]);
  });
});

describe('rebuildStaleBundles', () => {
  /** A root `build:actions` script that records its arguments, then exits with `code`. */
  function buildScript(code: number): void {
    const script = `require('fs').writeFileSync('built.txt', process.argv.slice(1).join(' ')); process.exit(${code});`;
    write('package.json', JSON.stringify({ name: 'root', scripts: { 'build:actions': `node -e "${script}"` } }), 100);
  }

  it('builds nothing and spawns nothing when every bundle is fresh', () => {
    buildScript(0);

    expect(rebuildStaleBundles(root)).toEqual([]);
    expect(() => readFileSync(path.join(root, 'built.txt'))).toThrow();
  });

  it('rebuilds exactly the stale build directories with build:actions', () => {
    buildScript(0);
    write('actions/a/fresh/src/action.ts', 'changed', 1);

    expect(rebuildStaleBundles(root)).toEqual(['actions/a/fresh']);
    expect(readFileSync(path.join(root, 'built.txt'), 'utf8')).toBe('actions/a/fresh');
  });

  it('throws with the exit code when the build fails', () => {
    buildScript(3);
    write('actions/a/fresh/src/action.ts', 'changed', 1);

    expect(() => rebuildStaleBundles(root)).toThrow(/Rebuilding stale bundles failed \(exit code 3\)/);
  });
});
