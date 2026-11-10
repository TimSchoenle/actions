import { afterEach, describe, expect, it } from 'vitest';

import { affected, rootBuildInputs, sourceInputs, workspacePackages } from './source-inputs.js';
import { compositeAction, createRepository, nodeAction, removeRepository } from './test-fixtures.js';

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) {
    removeRepository(root);
    root = undefined;
  }
});

function pkg(name: string, dependencies: Record<string, string> = {}, devDependencies: Record<string, string> = {}) {
  return JSON.stringify({ name, dependencies, devDependencies });
}

function monorepo(): string {
  root = createRepository({
    'package.json': pkg('root'),
    'bun.lock': '',
    '.bun-version': '1.4.4',
    'packages/util/package.json': pkg('util', { shared: 'workspace:*' }),
    'packages/shared/package.json': pkg('shared'),
    'packages/unused/package.json': pkg('unused'),
    'actions/a/action.yaml': nodeAction(),
    'actions/a/package.json': pkg('a', { util: 'workspace:*', yaml: '2.0.0' }),
    'actions/b/action.yaml': compositeAction([{ run: 'node "$GITHUB_ACTION_PATH/helper/dist/index.js"' }]),
    'actions/b/helper/action.yaml': nodeAction(),
    'actions/b/helper/package.json': pkg('b-helper', {}, { shared: 'workspace:^' }),
    'actions/c/action.yaml': compositeAction([{ uses: 'owner/repo@v1' }]),
    'actions/a/node_modules/util/package.json': pkg('util'),
  });

  return root;
}

describe('workspacePackages', () => {
  it('maps every package name to its directory, outside dependency trees', () => {
    expect(Object.fromEntries(workspacePackages(monorepo()))).toEqual({
      a: 'actions/a',
      'b-helper': 'actions/b/helper',
      shared: 'packages/shared',
      unused: 'packages/unused',
      util: 'packages/util',
    });
  });
});

describe('sourceInputs', () => {
  it('holds the action, its transitive workspace dependencies and the root build inputs', () => {
    expect(sourceInputs(monorepo(), ['actions/a'])).toEqual([
      '.bun-version',
      'actions/a',
      'bun.lock',
      'packages/shared',
      'packages/util',
    ]);
  });

  it('does not follow devDependencies, which never reach a bundle', () => {
    expect(sourceInputs(monorepo(), ['actions/b/helper'])).not.toContain('packages/shared');
  });

  it('lists only root build inputs that exist', () => {
    expect(rootBuildInputs(monorepo())).toEqual(['bun.lock', '.bun-version']);
  });
});

describe('affected', () => {
  it.each([
    ['packages/shared/src/x.ts', ['actions/a']],
    ['packages/util/src/x.ts', ['actions/a']],
    ['actions/b/helper/src/x.ts', ['actions/b']],
    ['bun.lock', ['actions/a', 'actions/b']],
    ['actions/c/action.yaml', ['actions/c']],
    ['packages/unused/src/x.ts', []],
    ['README.md', []],
  ])('maps a change to %s onto %j', (file, expected) => {
    expect(affected(monorepo(), [file], ['actions/a', 'actions/b', 'actions/c'])).toEqual(expected);
  });
});
