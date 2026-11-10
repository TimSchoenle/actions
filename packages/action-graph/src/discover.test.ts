import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findActions } from './discover.js';
import { createRepository, nodeAction, removeRepository } from './test-fixtures.js';

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) {
    removeRepository(root);
    root = undefined;
  }
});

describe('findActions', () => {
  it('finds every directory with a manifest, sorted, skipping dependency trees', () => {
    root = createRepository({
      'action.yml': nodeAction(),
      'actions/b/action.yaml': nodeAction(),
      'actions/a/action.yml': nodeAction(),
      'actions/a/helper/action.yaml': nodeAction(),
      'actions/a/node_modules/dep/action.yml': nodeAction(),
      '.github/actions/local/action.yml': nodeAction(),
      'templates/action.yaml': '{{ not yaml',
    });

    expect(findActions(root)).toEqual([
      '.',
      '.github/actions/local',
      'actions/a',
      'actions/a/helper',
      'actions/b',
      'templates',
    ]);
  });

  it('narrows to a subtree and skips excluded directories', () => {
    root = createRepository({
      'actions/a/action.yml': nodeAction(),
      'actions/fixture/action.yml': nodeAction(),
      'other/action.yml': nodeAction(),
    });

    expect(findActions(root, { within: 'actions', excludedDirectories: ['actions/fixture'] })).toEqual(['actions/a']);
  });

  it('does not follow a symbolic link', () => {
    root = createRepository({ 'real/action.yml': nodeAction() });
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'linked'), 'dir');

    expect(findActions(root)).toEqual(['real']);
  });
});
