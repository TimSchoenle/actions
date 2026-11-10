import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildSet, invokedNestedActions, mergeBuildSets } from './build-set.js';
import { findActions } from './discover.js';
import { readActionManifest } from './manifest.js';
import { compositeAction, createRepository, nodeAction, removeRepository } from './test-fixtures.js';

/** This repository, whose real actions the contract cases below run against. */
const REPOSITORY = fileURLToPath(new URL('../../..', import.meta.url));

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) {
    removeRepository(root);
    root = undefined;
  }
});

function fixture(files: Record<string, string>): string {
  root = createRepository(files);

  return root;
}

describe('buildSet', () => {
  it('holds a JavaScript action and its own bundles', () => {
    const dir = fixture({ 'actions/a/action.yaml': nodeAction('dist/index.js', { post: 'dist/post.js' }) });

    expect(buildSet(dir, ['actions/a'])).toEqual({
      actions: ['actions/a'],
      buildDirs: ['actions/a'],
      bundles: ['actions/a/dist/index.js', 'actions/a/dist/post.js'],
    });
  });

  it('follows a helper invoked through the action path, in every spelling the runner expands', () => {
    const dir = fixture({
      'actions/a/action.yaml': compositeAction([
        { run: 'node "$GITHUB_ACTION_PATH/helper/dist/index.js"' },
        { run: 'node ${GITHUB_ACTION_PATH}/second/dist/index.js --flag' },
        { run: 'node "${{ github.action_path }}/third/dist/index.js"' },
        { run: 'bash "$GITHUB_ACTION_PATH/scripts/run.sh"' },
      ]),
      'actions/a/helper/action.yaml': nodeAction(),
      'actions/a/second/action.yaml': nodeAction(),
      'actions/a/third/action.yaml': nodeAction(),
      'actions/a/scripts/run.sh': '',
      'actions/a/unused/action.yaml': nodeAction(),
    });

    expect(buildSet(dir, ['actions/a'])).toEqual({
      actions: ['actions/a', 'actions/a/helper', 'actions/a/second', 'actions/a/third'],
      buildDirs: ['actions/a/helper', 'actions/a/second', 'actions/a/third'],
      bundles: ['actions/a/helper/dist/index.js', 'actions/a/second/dist/index.js', 'actions/a/third/dist/index.js'],
    });
  });

  it('follows local uses transitively and treats remote references as leaves', () => {
    const dir = fixture({
      'actions/a/action.yaml': compositeAction([
        { uses: './actions/b' },
        { uses: 'owner/repo/actions/c@0000000000000000000000000000000000000000' },
      ]),
      'actions/b/action.yaml': compositeAction([{ uses: './actions/c' }, { uses: './actions/a' }]),
      'actions/c/action.yaml': nodeAction(),
    });

    expect(buildSet(dir, ['actions/a'])).toEqual({
      actions: ['actions/a', 'actions/b', 'actions/c'],
      buildDirs: ['actions/c'],
      bundles: ['actions/c/dist/index.js'],
    });
  });

  it('builds a root action in place', () => {
    const dir = fixture({ 'action.yml': nodeAction('dist/index.js') });

    expect(buildSet(dir, ['.'])).toEqual({ actions: ['.'], buildDirs: ['.'], bundles: ['dist/index.js'] });
  });

  it('ignores an action-path reference that climbs out of the action', () => {
    const dir = fixture({
      'actions/a/action.yaml': compositeAction([{ run: 'node "$GITHUB_ACTION_PATH/../b/dist/index.js"' }]),
      'actions/b/action.yaml': nodeAction(),
    });

    expect(buildSet(dir, ['actions/a']).buildDirs).toEqual([]);
  });

  it('fails for a local reference to a directory without a manifest', () => {
    const dir = fixture({ 'actions/a/action.yaml': compositeAction([{ uses: './actions/missing' }]) });

    expect(() => buildSet(dir, ['actions/a'])).toThrow(/actions\/missing: no action.yml or action.yaml found/);
  });
});

describe('mergeBuildSets', () => {
  it('unions and sorts', () => {
    expect(
      mergeBuildSets([
        { actions: ['b'], buildDirs: ['b'], bundles: ['b/x'] },
        { actions: ['a', 'b'], buildDirs: [], bundles: [] },
      ]),
    ).toEqual({ actions: ['a', 'b'], buildDirs: ['b'], bundles: ['b/x'] });
  });
});

describe('the actions of this repository', () => {
  const actions = findActions(REPOSITORY, { within: 'actions' });

  it('finds every nested helper manifest through the composite that invokes it', () => {
    const nested = actions.filter((dir) => dir.split('/').length > 3);
    const invoked = actions
      .map((dir) => readActionManifest(REPOSITORY, dir))
      .filter((manifest) => manifest.using === 'composite')
      .flatMap((manifest) => invokedNestedActions(REPOSITORY, manifest));

    expect(nested.length).toBeGreaterThan(0);
    expect(invoked.sort()).toEqual(nested);
  });

  it.each([
    ['actions/common/create-patch', ['actions/common/create-patch/helper']],
    ['actions/common/commit-patch', ['actions/common/commit-patch/helper']],
    ['actions/common/find-patch', ['actions/common/find-patch/helper']],
    ['actions/common/generated-files-verdict', ['actions/common/generated-files-verdict/helper']],
    ['actions/docker/image-check', ['actions/docker/image-check/helper']],
    ['actions/docker/image-check-summary', ['actions/docker/image-check-summary/helper']],
    ['actions/common/read-yaml', ['actions/common/read-yaml']],
  ])('builds %s from %j', (target, buildDirs) => {
    const set = buildSet(REPOSITORY, [target]);

    expect(set.buildDirs).toEqual(buildDirs);
    expect(set.bundles).toEqual(buildDirs.map((dir) => `${dir}/dist/index.js`));
  });

  it('builds nothing for a composite that only pins remote actions', () => {
    expect(buildSet(REPOSITORY, ['actions/bun/setup-cached']).bundles).toEqual([]);
  });
});
