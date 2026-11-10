import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runInProcess } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from './action.js';
import { resolveActions } from './resolve.js';

import type { ResolveRequest } from './resolve.js';

const NODE_ACTION = "runs:\n  using: 'node24'\n  main: 'dist/index.js'\n";
const HELPER_COMPOSITE =
  'runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: node "$GITHUB_ACTION_PATH/helper/dist/index.js"\n';

let root: string;

function write(file: string, content: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), 'resolve-actions-'));
  write('package.json', JSON.stringify({ name: 'root' }));
  write('bun.lock', '');
  write('packages/util/package.json', JSON.stringify({ name: 'util' }));
  write('actions/a/action.yaml', NODE_ACTION);
  write('actions/a/package.json', JSON.stringify({ name: 'a', dependencies: { util: 'workspace:*' } }));
  write('actions/b/action.yaml', HELPER_COMPOSITE);
  write('actions/b/helper/action.yaml', NODE_ACTION);
  write('actions/c/action.yaml', 'runs:\n  using: composite\n  steps:\n    - uses: ./actions/a\n');
  write('templates/action.yaml', '{{ not an action }}');
  write(
    '.github/workflows/test.yaml',
    'on: push\njobs:\n  t:\n    runs-on: x\n    steps:\n      - uses: ./tmp/code/actions/b\n',
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function request(overrides: Partial<ResolveRequest>): ResolveRequest {
  return {
    root,
    targets: [],
    workflows: [],
    checkoutPrefixes: [],
    exclude: ['templates'],
    mode: 'build-set',
    changedFiles: [],
    ...overrides,
  };
}

describe('resolveActions', () => {
  it('resolves the closure of the targets, with source globs', () => {
    expect(resolveActions(request({ targets: ['actions/c'] }))).toEqual({
      actions: ['actions/a', 'actions/c'],
      buildDirs: ['actions/a'],
      bundles: ['actions/a/dist/index.js'],
      sourcePaths: ['actions/a/**', 'actions/c/**', 'bun.lock', 'packages/util/**'],
    });
  });

  it('adds the local actions a workflow runs, without the checkout prefix', () => {
    const resolution = resolveActions(
      request({ workflows: ['.github/workflows/test.yaml'], checkoutPrefixes: ['tmp/code'] }),
    );

    expect(resolution.buildDirs).toEqual(['actions/b/helper']);
  });

  it('takes every action, minus exclude, when nothing is named', () => {
    expect(resolveActions(request({})).buildDirs).toEqual(['actions/a', 'actions/b/helper']);
  });

  it('keeps only the affected actions in affected mode', () => {
    const resolution = resolveActions(request({ mode: 'affected', changedFiles: ['packages/util/src/x.ts'] }));

    expect(resolution.actions).toEqual(['actions/a', 'actions/c']);
    expect(resolution.buildDirs).toEqual(['actions/a']);
  });

  it('resolves nothing when no change affects any action', () => {
    expect(resolveActions(request({ mode: 'affected', changedFiles: ['README.md'] }))).toEqual({
      actions: [],
      buildDirs: [],
      bundles: [],
      sourcePaths: [],
    });
  });

  it('names a workflow that does not exist', () => {
    expect(() => resolveActions(request({ workflows: ['.github/workflows/missing.yaml'] }))).toThrow(
      /missing\.yaml does not exist/,
    );
  });
});

describe('run', () => {
  const defaults = {
    targets: '',
    workflows: '',
    'checkout-prefixes': '',
    exclude: 'templates',
    mode: 'build-set',
    'changed-files': '',
    path: '.',
  };

  it('publishes every list as a JSON output', async () => {
    const result = await runInProcess({ ...defaults, targets: 'actions/b' }, run, { GITHUB_WORKSPACE: root });

    expect(result.exitCode).toBe(0);
    expect(result.outputs).toEqual({
      'build-dirs': '["actions/b/helper"]',
      bundles: '["actions/b/helper/dist/index.js"]',
      actions: '["actions/b","actions/b/helper"]',
      'source-paths': '["actions/b/**","actions/b/helper/**","bun.lock"]',
    });
  });

  it('resolves below a checkout path', async () => {
    const result = await runInProcess({ ...defaults, targets: 'a', path: 'actions' }, run, {
      GITHUB_WORKSPACE: root,
    });

    expect(result.outputs['bundles']).toBe('["a/dist/index.js"]');
  });

  it.each([
    [{ mode: 'everything' }, /mode must be one of build-set, affected/],
    [{ path: '../outside' }, /'\.\.' segment/],
    [{ path: 'missing' }, /is not a directory of the workspace/],
    [{ targets: 'actions/none' }, /actions\/none: no action\.yml or action\.yaml found/],
  ])('fails the step for %j', async (inputs, message) => {
    const result = await runInProcess({ ...defaults, ...inputs }, run, { GITHUB_WORKSPACE: root });

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(message);
    expect(result.outputs).toEqual({});
  });
});
