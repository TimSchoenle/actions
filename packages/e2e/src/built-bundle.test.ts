import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { serializeManifest, sha256Hex } from 'action-graph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertBuiltBundle, BuiltBundleError } from './built-bundle.js';

let root: string;
let manifest: string;
let bundle: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'built-bundle-'));
  bundle = path.join(root, 'actions/a/dist/index.js');
  mkdirSync(path.dirname(bundle), { recursive: true });
  writeFileSync(bundle, 'built();\n');
  manifest = path.join(root, 'bundles.json');
  writeFileSync(
    manifest,
    serializeManifest({
      schema: 1,
      sourceSha: 'a'.repeat(40),
      toolchain: '',
      generatedBy: 'test',
      buildDirs: ['actions/a'],
      files: [{ path: 'actions/a/dist/index.js', sha256: sha256Hex('built();\n'), size: 9 }],
    }),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('assertBuiltBundle', () => {
  it('accepts a listed bundle with the built content', () => {
    expect(() => assertBuiltBundle(bundle, { BUILT_ACTIONS_MANIFEST: manifest, CI: 'true' }, root)).not.toThrow();
  });

  it('refuses a bundle that differs from the build', () => {
    writeFileSync(bundle, 'committed();\n');

    expect(() => assertBuiltBundle(bundle, { BUILT_ACTIONS_MANIFEST: manifest }, root)).toThrow(/but this run built/);
  });

  it('refuses a bundle the build set does not list, naming the generator', () => {
    const other = path.join(root, 'actions/b/dist/index.js');

    expect(() => assertBuiltBundle(other, { BUILT_ACTIONS_MANIFEST: manifest }, root)).toThrow(
      /actions\/b\/dist\/index\.js is not in this run's build set; run `bun run generate-verify`/,
    );
  });

  it('requires the manifest in CI and not locally', () => {
    expect(() => assertBuiltBundle(bundle, { CI: 'true' }, root)).toThrow(BuiltBundleError);
    expect(() => assertBuiltBundle(bundle, {}, root)).not.toThrow();
  });

  it('checks a bundle under a repository directory whose name starts with two dots', () => {
    expect(() => assertBuiltBundle(path.join(root, '..foo/dist/index.js'), { CI: 'true' }, root)).toThrow(
      BuiltBundleError,
    );
  });

  it('does not check a bundle outside the repository', () => {
    expect(() => assertBuiltBundle(path.join(tmpdir(), 'elsewhere/index.js'), { CI: 'true' }, root)).not.toThrow();
  });
});
