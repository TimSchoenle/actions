import { afterEach, describe, expect, it } from 'vitest';

import {
  findManifestFile,
  isNodeRuntime,
  localUsesPath,
  ManifestError,
  parseActionManifest,
  readActionManifest,
} from './manifest.js';
import { compositeAction, createRepository, nodeAction, removeRepository } from './test-fixtures.js';

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) {
    removeRepository(root);
    root = undefined;
  }
});

describe('parseActionManifest', () => {
  it('resolves every entry point of a JavaScript action against its directory', () => {
    const manifest = parseActionManifest(
      nodeAction('./dist/main.js', { pre: 'dist/pre.js', post: 'dist/post.js' }),
      'actions/a/action.yaml',
    );

    expect(manifest).toMatchObject({
      directory: 'actions/a',
      file: 'actions/a/action.yaml',
      using: 'node24',
      bundles: ['actions/a/dist/pre.js', 'actions/a/dist/main.js', 'actions/a/dist/post.js'],
      localUses: [],
    });
  });

  it('places a root action at the root', () => {
    expect(parseActionManifest(nodeAction(), 'action.yml')).toMatchObject({
      directory: '.',
      bundles: ['dist/index.js'],
    });
  });

  it('collects local uses and run scripts of a composite, and ignores remote ones', () => {
    const manifest = parseActionManifest(
      compositeAction([
        { uses: './actions/b' },
        { uses: 'actions/checkout@0000000000000000000000000000000000000000' },
        { uses: 'docker://alpine:3' },
        { run: 'node "$GITHUB_ACTION_PATH/helper/dist/index.js"' },
      ]),
      'actions/a/action.yaml',
    );

    expect(manifest.bundles).toEqual([]);
    expect(manifest.localUses).toEqual(['actions/b']);
    expect(manifest.runScripts).toEqual(['node "$GITHUB_ACTION_PATH/helper/dist/index.js"']);
  });

  it('records no bundles for a Docker action', () => {
    expect(parseActionManifest("runs:\n  using: docker\n  image: 'Dockerfile'\n", 'a/action.yml').bundles).toEqual([]);
  });

  it.each([
    ['not yaml', 'runs: [', /not valid YAML/],
    ['no runs', 'name: x\n', /'runs.using' is missing/],
    ['no main', "runs:\n  using: 'node24'\n", /declares no 'runs.main'/],
    ['escaping main', "runs:\n  using: 'node24'\n  main: '../x.js'\n", /'\.\.' segment/],
    ['empty post', "runs:\n  using: 'node24'\n  main: 'a.js'\n  post: ''\n", /'runs.post' must be/],
    ['steps not a list', 'runs:\n  using: composite\n  steps: {}\n', /must be a list/],
    [
      'escaping local uses',
      'runs:\n  using: composite\n  steps:\n    - uses: ./../x\n',
      /a\/action\.yaml: .*'\.\.' segment/,
    ],
  ])('rejects a manifest with %s', (_name, content, message) => {
    expect(() => parseActionManifest(content, 'a/action.yaml')).toThrow(ManifestError);
    expect(() => parseActionManifest(content, 'a/action.yaml')).toThrow(message);
  });
});

describe('localUsesPath', () => {
  it.each([
    ['./actions/x', 'actions/x'],
    ['./actions/x/', 'actions/x'],
    ['.', '.'],
    ['owner/repo@v1', undefined],
    ['docker://x', undefined],
  ])('maps %j to %j', (uses, expected) => {
    expect(localUsesPath(uses)).toBe(expected);
  });
});

describe('isNodeRuntime', () => {
  it('accepts nodeNN only', () => {
    expect(isNodeRuntime('node24')).toBe(true);
    expect(isNodeRuntime('node')).toBe(false);
    expect(isNodeRuntime('composite')).toBe(false);
  });
});

describe('readActionManifest', () => {
  it('prefers action.yml over action.yaml, as the runner does', () => {
    root = createRepository({ 'a/action.yml': nodeAction('first.js'), 'a/action.yaml': nodeAction('second.js') });

    expect(findManifestFile(root, 'a')).toBe('a/action.yml');
    expect(readActionManifest(root, 'a').bundles).toEqual(['a/first.js']);
  });

  it('fails for a directory without a manifest', () => {
    root = createRepository({ 'a/README.md': '' });

    expect(() => readActionManifest(root as string, 'a')).toThrow(/no action.yml or action.yaml found/);
  });
});
