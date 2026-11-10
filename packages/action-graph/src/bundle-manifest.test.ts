import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BundleVerificationError,
  CHECKSUMS_FILE,
  installBundles,
  MANIFEST_FILE,
  parseBundleManifest,
  renderChecksums,
  replaceableDirectories,
  serializeManifest,
  stageBundles,
  verifyBundleDirectory,
} from './bundle-manifest.js';
import { sha256Hex } from './hash.js';
import { writeFiles } from './test-fixtures.js';

import type { BundleManifest, StagedBundles } from './bundle-manifest.js';

const SOURCE_SHA = 'a'.repeat(40);
const METADATA = { sourceSha: SOURCE_SHA, toolchain: 'bun 1.4.4', generatedBy: 'test' };

let scratch: string;
let checkout: string;
let staging: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(tmpdir(), 'bundle-manifest-'));
  checkout = path.join(scratch, 'checkout');
  staging = path.join(scratch, 'staging');
  writeFiles(checkout, {
    'actions/a/dist/index.js': 'a();\n',
    'actions/b/helper/dist/index.js': 'b();\n',
    'actions/b/helper/dist/index.js.map': 'unlisted output',
  });
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function stage(): StagedBundles {
  return stageBundles(
    checkout,
    ['actions/b/helper', 'actions/a'],
    ['actions/b/helper/dist/index.js', 'actions/a/dist/index.js'],
    staging,
    METADATA,
  );
}

function expectRejected(action: () => unknown, message: RegExp): void {
  expect(action).toThrow(BundleVerificationError);
  expect(action).toThrow(message);
}

describe('stageBundles', () => {
  it('copies the bundles to their paths and writes a manifest whose hash names its bytes', () => {
    const staged = stage();

    expect(staged.manifest).toEqual({
      schema: 1,
      ...METADATA,
      buildDirs: ['actions/a', 'actions/b/helper'],
      files: [
        { path: 'actions/a/dist/index.js', sha256: sha256Hex('a();\n'), size: 5 },
        { path: 'actions/b/helper/dist/index.js', sha256: sha256Hex('b();\n'), size: 5 },
      ],
    });
    expect(fs.readFileSync(path.join(staging, MANIFEST_FILE), 'utf8')).toBe(staged.manifestText);
    expect(staged.manifestSha256).toBe(sha256Hex(staged.manifestText));
    expect(fs.readFileSync(path.join(staging, CHECKSUMS_FILE), 'utf8')).toBe(
      `${sha256Hex('a();\n')}  actions/a/dist/index.js\n${sha256Hex('b();\n')}  actions/b/helper/dist/index.js\n`,
    );
    expect(fs.existsSync(path.join(staging, 'actions/b/helper/dist/index.js.map'))).toBe(false);
  });

  it('names every bundle the build did not produce', () => {
    fs.rmSync(path.join(checkout, 'actions/a/dist'), { recursive: true });

    expectRejected(stage, /did not produce: actions\/a\/dist\/index\.js/);
  });

  it('refuses a bundle that is a symbolic link', () => {
    fs.rmSync(path.join(checkout, 'actions/a/dist/index.js'));
    fs.symlinkSync(path.join(scratch, 'elsewhere'), path.join(checkout, 'actions/a/dist/index.js'));
    fs.writeFileSync(path.join(scratch, 'elsewhere'), 'x');

    expectRejected(stage, /symbolic link/);
  });

  it('rejects a bundle path that leaves the checkout before reading or writing anything', () => {
    // Read from `<scratch>/outside.js`; staged one level deeper, the write would land in `<scratch>/deep`.
    writeFiles(scratch, { 'outside.js': 'secret();\n' });
    const deepStaging = path.join(scratch, 'deep', 'staging');

    expectRejected(
      () => stageBundles(checkout, ['actions/a'], ['actions/a/../../../outside.js'], deepStaging, METADATA),
      /contains a '\.\.' segment/,
    );
    expect(fs.existsSync(path.join(scratch, 'deep', 'outside.js'))).toBe(false);
    expect(fs.readdirSync(deepStaging)).toEqual([]);
  });

  it('rejects a bundle path that is not canonical', () => {
    expectRejected(
      () => stageBundles(checkout, ['actions/a'], ['actions/a/./dist/index.js'], staging, METADATA),
      /not in canonical form/,
    );
  });

  it('refuses a staging directory that is not empty', () => {
    writeFiles(staging, { leftover: '' });

    expectRejected(stage, /not empty/);
  });
});

describe('verifyBundleDirectory', () => {
  it('accepts an untouched artifact', () => {
    const staged = stage();

    expect(verifyBundleDirectory(staging, staged.manifestSha256).manifest).toEqual(staged.manifest);
  });

  it('fails closed on a wrong manifest hash', () => {
    stage();

    expectRejected(() => verifyBundleDirectory(staging, 'f'.repeat(64)), /bundles\.json has SHA-256 .* expected f{64}/);
  });

  it('rejects a malformed expected hash before reading anything', () => {
    expectRejected(() => verifyBundleDirectory(staging, 'ABC'), /64 lowercase hexadecimal/);
  });

  it('fails closed on a file the manifest does not list', () => {
    const staged = stage();
    writeFiles(staging, { 'actions/a/dist/extra.js': 'evil();' });

    expectRejected(
      () => verifyBundleDirectory(staging, staged.manifestSha256),
      /does not list: actions\/a\/dist\/extra\.js/,
    );
  });

  it('fails closed on a listed file that is missing', () => {
    const staged = stage();
    fs.rmSync(path.join(staging, 'actions/a/dist/index.js'));

    expectRejected(
      () => verifyBundleDirectory(staging, staged.manifestSha256),
      /missing files .*actions\/a\/dist\/index\.js/,
    );
  });

  it('fails closed on modified content', () => {
    const staged = stage();
    fs.writeFileSync(path.join(staging, 'actions/a/dist/index.js'), 'b();\n');

    expectRejected(() => verifyBundleDirectory(staging, staged.manifestSha256), /has SHA-256 .* the manifest says/);
  });

  it('fails closed on a size mismatch', () => {
    const staged = stage();
    fs.writeFileSync(path.join(staging, 'actions/a/dist/index.js'), 'longer();\n');

    expectRejected(() => verifyBundleDirectory(staging, staged.manifestSha256), /is 10 bytes, the manifest says 5/);
  });

  it('fails closed on a symbolic link anywhere in the artifact', () => {
    const staged = stage();
    fs.symlinkSync('/etc', path.join(staging, 'actions/a/linked'));

    expectRejected(() => verifyBundleDirectory(staging, staged.manifestSha256), /symbolic link: actions\/a\/linked/);
  });

  it('fails closed on a checksum list that disagrees with the manifest', () => {
    const staged = stage();
    fs.writeFileSync(path.join(staging, CHECKSUMS_FILE), '');

    expectRejected(() => verifyBundleDirectory(staging, staged.manifestSha256), /bundles\.sha256 does not match/);
  });

  it('fails closed on a manifest path with a .. segment, even when the hash matches', () => {
    const manifest = `${JSON.stringify({
      schema: 1,
      ...METADATA,
      buildDirs: ['actions/a'],
      files: [{ path: 'actions/a/../../escape.js', sha256: sha256Hex(''), size: 0 }],
    })}\n`;
    writeFiles(staging, { [MANIFEST_FILE]: manifest });

    expectRejected(() => verifyBundleDirectory(staging, sha256Hex(manifest)), /'\.\.' segment/);
  });
});

describe('parseBundleManifest', () => {
  const valid: BundleManifest = {
    schema: 1,
    ...METADATA,
    buildDirs: ['actions/a'],
    files: [{ path: 'actions/a/dist/index.js', sha256: 'b'.repeat(64), size: 1 }],
  };

  function withChange(change: Record<string, unknown>): string {
    return JSON.stringify({ ...valid, ...change });
  }

  it('round-trips through serializeManifest', () => {
    expect(parseBundleManifest(serializeManifest(valid))).toEqual(valid);
  });

  it.each([
    ['not JSON', '{', /not valid JSON/],
    ['an array', '[]', /expected a JSON object/],
    ['an unknown key', withChange({ extra: 1 }), /unknown keys: extra/],
    ['another schema', withChange({ schema: 2 }), /'schema' must be 1/],
    ['a short source sha', withChange({ sourceSha: 'abc' }), /'sourceSha'/],
    ['no build directories', withChange({ buildDirs: [] }), /'buildDirs' must be a non-empty list/],
    ['unsorted build directories', withChange({ buildDirs: ['b', 'a'] }), /must be sorted/],
    ['a non-canonical path', withChange({ buildDirs: ['./actions/a'] }), /not in canonical form/],
    ['no files', withChange({ files: [] }), /'files' must be a non-empty list/],
    [
      'a file outside every build directory',
      withChange({ files: [{ path: 'scripts/x.js', sha256: 'b'.repeat(64), size: 1 }] }),
      /outside every build directory/,
    ],
    [
      'an absolute path',
      withChange({ files: [{ path: '/etc/passwd', sha256: 'b'.repeat(64), size: 1 }] }),
      /is absolute/,
    ],
    [
      'a reserved name',
      withChange({ buildDirs: ['.'], files: [{ path: MANIFEST_FILE, sha256: 'b'.repeat(64), size: 1 }] }),
      /is reserved/,
    ],
    [
      'an uppercase digest',
      withChange({ files: [{ path: 'actions/a/x', sha256: 'B'.repeat(64), size: 1 }] }),
      /lowercase hexadecimal SHA-256/,
    ],
    ['a negative size', withChange({ files: [{ path: 'actions/a/x', sha256: 'b'.repeat(64), size: -1 }] }), /size/],
    [
      'an unknown file key',
      withChange({ files: [{ path: 'actions/a/x', sha256: 'b'.repeat(64), size: 1, mode: 1 }] }),
      /unknown keys: mode/,
    ],
    ['a toolchain with a newline', withChange({ toolchain: 'a\nb' }), /without control characters/],
    ['an empty generator', withChange({ generatedBy: '' }), /'generatedBy' must be a non-empty string/],
  ])('rejects %s', (_name, text, message) => {
    expectRejected(() => parseBundleManifest(text), message);
  });
});

describe('renderChecksums', () => {
  it('uses the sha256sum text format', () => {
    expect(renderChecksums([{ path: 'a/b', sha256: 'c'.repeat(64), size: 1 }])).toBe(`${'c'.repeat(64)}  a/b\n`);
  });
});

describe('installBundles', () => {
  it('replaces each bundle directory, so a stale committed file cannot survive', () => {
    const staged = verifyBundleDirectory(staging, stage().manifestSha256);
    const target = path.join(scratch, 'target');
    writeFiles(target, {
      'actions/a/dist/index.js': 'stale',
      'actions/a/dist/chunk-stale.js': 'stale',
      'actions/a/src/action.ts': 'source',
    });

    expect(installBundles(staged, target, true)).toEqual(['actions/a/dist/index.js', 'actions/b/helper/dist/index.js']);
    expect(fs.readFileSync(path.join(target, 'actions/a/dist/index.js'), 'utf8')).toBe('a();\n');
    expect(fs.existsSync(path.join(target, 'actions/a/dist/chunk-stale.js'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'actions/a/src/action.ts'))).toBe(true);
  });

  it('leaves sibling files in place without replace', () => {
    const staged = verifyBundleDirectory(staging, stage().manifestSha256);
    const target = path.join(scratch, 'target');
    writeFiles(target, { 'actions/a/dist/keep.js': 'keep' });

    installBundles(staged, target, false);

    expect(fs.existsSync(path.join(target, 'actions/a/dist/keep.js'))).toBe(true);
  });

  it('refuses to write through a symbolic link in the target checkout', () => {
    const staged = verifyBundleDirectory(staging, stage().manifestSha256);
    const target = path.join(scratch, 'target');
    const outside = path.join(scratch, 'outside');
    fs.mkdirSync(path.join(target, 'actions/a'), { recursive: true });
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(target, 'actions/a/dist'), 'dir');

    expectRejected(() => installBundles(staged, target, true), /symbolic link actions\/a\/dist/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe('replaceableDirectories', () => {
  it('never clears a build directory itself', () => {
    const manifest: BundleManifest = {
      schema: 1,
      ...METADATA,
      buildDirs: ['.', 'actions/x'],
      files: [
        { path: 'actions/x/dist/index.js', sha256: 'b'.repeat(64), size: 1 },
        { path: 'index.js', sha256: 'b'.repeat(64), size: 1 },
      ],
    };

    expect(replaceableDirectories(manifest)).toEqual(['actions/x/dist']);
  });

  it('gives a bundle to the innermost build directory, so a nested action written in place keeps its sources', () => {
    const manifest: BundleManifest = {
      schema: 1,
      ...METADATA,
      buildDirs: ['.', 'actions/x'],
      files: [{ path: 'actions/x/index.js', sha256: 'b'.repeat(64), size: 1 }],
    };

    expect(replaceableDirectories(manifest)).toEqual([]);
  });
});
