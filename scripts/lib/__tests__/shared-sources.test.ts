import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sha256Hex } from 'action-graph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectSharedSources, isSharedSourceFile, renderSharedSources } from '../shared-sources';

let root: string;

function write(relativePath: string, content: string): void {
  const file = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function packageJson(name: string, dependencies: Record<string, string> = {}, devDependencies = {}): string {
  return JSON.stringify({ name, dependencies, devDependencies });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'shared-sources-'));
  write('package.json', JSON.stringify({ name: 'root', private: true }));
  write('bun.lock', 'lock');
  write('packages/util/package.json', packageJson('util', { inner: 'workspace:*' }));
  write('packages/util/src/index.ts', 'export const a = 1;\n');
  write('packages/util/src/nested/deep.ts', 'export const b = 2;\n');
  write('packages/util/src/index.test.ts', 'test');
  write('packages/util/src/__tests__/helper.ts', 'helper');
  write('packages/util/src/__fixtures__/data.json', '{}');
  write('packages/util/src/node_modules/x/index.js', 'vendored');
  write('packages/util/README.md', 'docs');
  write('packages/inner/package.json', packageJson('inner'));
  write('packages/inner/src/inner.ts', 'export const c = 3;\n');
  write('packages/harness/package.json', packageJson('harness'));
  write('packages/harness/src/harness.ts', 'export const d = 4;\n');
  write('actions/demo/one/package.json', packageJson('one', { util: 'workspace:*' }, { harness: 'workspace:*' }));
  write('actions/demo/one/src/action.ts', 'export async function run() {}\n');
  write('actions/demo/two/package.json', packageJson('two', { 'left-pad': '1.0.0' }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('isSharedSourceFile', () => {
  it.each(['index.ts', 'nested/deep.ts', 'core.mts', 'data.json'])('counts %s as bundled', (file) => {
    expect(isSharedSourceFile(file)).toBe(true);
  });

  it.each([
    'index.test.ts',
    'index.spec.ts',
    'commit.e2e.test.ts',
    'patch.property.test.mts',
    '__tests__/helper.ts',
    'nested/__fixtures__/data.json',
    '__mocks__/fs.ts',
    'node_modules/x/index.js',
  ])('leaves out %s, which no bundle contains', (file) => {
    expect(isSharedSourceFile(file)).toBe(false);
  });
});

describe('collectSharedSources', () => {
  it('hashes every bundled source file of every workspace package the action reaches, transitively', () => {
    const sources = collectSharedSources(root, 'actions/demo/one');

    expect(sources).toEqual([
      {
        name: 'inner',
        directory: 'packages/inner',
        files: [{ path: 'src/inner.ts', sha256: sha256Hex('export const c = 3;\n') }],
      },
      {
        name: 'util',
        directory: 'packages/util',
        files: [
          { path: 'src/index.ts', sha256: sha256Hex('export const a = 1;\n') },
          { path: 'src/nested/deep.ts', sha256: sha256Hex('export const b = 2;\n') },
        ],
      },
    ]);
  });

  it('leaves out devDependencies, the action itself and the root lockfile', () => {
    const directories = collectSharedSources(root, 'actions/demo/one').map((entry) => entry.directory);

    expect(directories).not.toContain('packages/harness');
    expect(directories).not.toContain('actions/demo/one');
    expect(directories).not.toContain('bun.lock');
  });

  it('is empty for an action that depends on no workspace package', () => {
    expect(collectSharedSources(root, 'actions/demo/two')).toEqual([]);
  });

  it('changes when a bundled source changes, and only then', () => {
    const before = renderSharedSources('actions/demo/one', collectSharedSources(root, 'actions/demo/one'));

    write('packages/util/src/index.test.ts', 'a different test');
    write('packages/util/README.md', 'different docs');
    write('packages/harness/src/harness.ts', 'export const d = 5;\n');
    expect(renderSharedSources('actions/demo/one', collectSharedSources(root, 'actions/demo/one'))).toBe(before);

    write('packages/inner/src/inner.ts', 'export const c = 4;\n');
    expect(renderSharedSources('actions/demo/one', collectSharedSources(root, 'actions/demo/one'))).not.toBe(before);
  });

  it('lists files in byte order, so the result does not depend on the filesystem', () => {
    write('packages/inner/src/B.ts', 'b');
    write('packages/inner/src/a.ts', 'a');

    const paths = collectSharedSources(root, 'actions/demo/one')
      .find((entry) => entry.name === 'inner')
      ?.files.map((file) => file.path);

    expect(paths).toEqual(['src/B.ts', 'src/a.ts', 'src/inner.ts']);
  });
});

describe('renderSharedSources', () => {
  it('renders stable, newline-terminated JSON that names the generator', () => {
    const rendered = renderSharedSources('actions/demo/one', collectSharedSources(root, 'actions/demo/one'));

    expect(rendered.endsWith('}\n')).toBe(true);
    const parsed = JSON.parse(rendered) as { comment: string; packages: Record<string, unknown> };
    expect(parsed.comment).toContain('bun run generate-action-sources');
    expect(Object.keys(parsed.packages)).toEqual(['packages/inner', 'packages/util']);
    expect(parsed.packages['packages/util']).toEqual({
      name: 'util',
      files: {
        'src/index.ts': sha256Hex('export const a = 1;\n'),
        'src/nested/deep.ts': sha256Hex('export const b = 2;\n'),
      },
    });
  });

  it('renders an empty package map for an action without shared packages', () => {
    const parsed = JSON.parse(renderSharedSources('actions/demo/two', [])) as { packages: object };

    expect(parsed.packages).toEqual({});
  });
});
