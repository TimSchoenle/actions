import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MANIFEST_FILE, sha256Hex, verifyBundleDirectory } from 'action-graph';
import { runInProcess } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { GENERATED_BY } from './build.js';

import type { ShellRunner } from './build.js';

const SHA = 'c'.repeat(40);
const NODE_ACTION = "runs:\n  using: 'node24'\n  main: 'dist/index.js'\n";

let scratch: string;
let workspace: string;
let temp: string;

function write(file: string, content: string): void {
  const target = path.join(workspace, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(tmpdir(), 'build-actions-helper-'));
  workspace = path.join(scratch, 'workspace');
  temp = path.join(scratch, 'temp');
  fs.mkdirSync(temp, { recursive: true });
  write('actions/a/action.yaml', NODE_ACTION);
  write('actions/b/action.yaml', NODE_ACTION);
  write('actions/c/action.yaml', 'runs:\n  using: composite\n  steps: []\n');
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const INPUTS = {
  build_dirs: 'actions/a\nactions/b',
  build_command: 'mkdir -p dist && printf "%s" "$BUILD_DIR" > dist/index.js',
  per_directory: 'true',
  artifact_name: 'built-actions-1',
  retention_days: '1',
  source_sha: SHA,
  toolchain: 'bun 1.4.4',
  path: '.',
};

function build(inputs: Partial<typeof INPUTS> = {}, shell?: ShellRunner) {
  return runInProcess({ ...INPUTS, ...inputs }, () => run({ workspace, temp }, shell));
}

describe('run', () => {
  it('builds each directory with BUILD_DIR set and stages a verifiable artifact', async () => {
    const result = await build();

    expect(result.exitCode).toBe(0);
    const directory = result.outputs['directory'];
    expect(path.dirname(directory)).toBe(temp);
    const verified = verifyBundleDirectory(directory, result.outputs['manifest_sha256']);
    expect(verified.manifest).toMatchObject({ sourceSha: SHA, toolchain: 'bun 1.4.4', generatedBy: GENERATED_BY });
    expect(JSON.parse(result.outputs['bundles'])).toEqual([
      { path: 'actions/a/dist/index.js', sha256: sha256Hex('actions/a'), size: 9 },
      { path: 'actions/b/dist/index.js', sha256: sha256Hex('actions/b'), size: 9 },
    ]);
    expect(result.outputs).toMatchObject({ artifact_name: 'built-actions-1', retention_days: '1' });
    expect(fs.readFileSync(path.join(directory, MANIFEST_FILE), 'utf8')).toBe(verified.manifestText);
  });

  it('accepts the JSON array resolve-actions outputs', async () => {
    const result = await build({ build_dirs: '["actions/b","actions/a"]' });

    expect(result.exitCode).toBe(0);
  });

  it('runs the command once at the root with BUILD_DIRS when per-directory is false', async () => {
    const result = await build({
      per_directory: 'false',
      build_command:
        'while read -r dir; do mkdir -p "$dir/dist"; printf "%s" "$BUILD_DIRS" > "$dir/dist/index.js"; done <<< "$BUILD_DIRS"',
    });

    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(workspace, 'actions/a/dist/index.js'), 'utf8')).toBe('actions/a\nactions/b');
  });

  it("does not pass this step's INPUT_ variables to the build", async () => {
    const result = await build({
      build_command: 'mkdir -p dist && (env | grep "^INPUT_" || true) > dist/index.js',
    });

    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(workspace, 'actions/a/dist/index.js'), 'utf8')).toBe('');
  });

  it('fails when the build command fails, naming the directory', async () => {
    const result = await build({ build_command: 'exit 3' });

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(/failed in actions\/a with exit code 3/);
    expect(result.outputs).toEqual({});
  });

  it('fails when the build does not produce a bundle the manifest names', async () => {
    const result = await build({ build_command: 'true' });

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(
      /did not produce: actions\/a\/dist\/index\.js, actions\/b\/dist\/index\.js/,
    );
  });

  it.each([
    [{ build_dirs: 'actions/c' }, /actions\/c: runs on 'composite', which ships no bundle/],
    [{ build_dirs: 'actions/missing' }, /actions\/missing: not a directory of the checkout/],
    [{ build_dirs: '../escape' }, /'\.\.' segment/],
    [{ build_dirs: '[]' }, /lists no directory/],
    [{ artifact_name: 'has space' }, /artifact-name must be/],
    [{ artifact_name: 'x'.repeat(101) }, /artifact-name must be/],
    [{ retention_days: '0' }, /retention-days must be/],
    [{ retention_days: '91' }, /retention-days must be/],
    [{ source_sha: 'main' }, /source-sha must be a full lowercase commit id/],
    [{ per_directory: 'yes' }, /per-directory must be true or false/],
    [{ toolchain: 'a\nb' }, /toolchain must be/],
  ])('fails for %j before running anything', async (inputs, message) => {
    const shell = vi.fn<ShellRunner>().mockResolvedValue(0);
    const result = await build(inputs, shell);

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(message);
    expect(shell).not.toHaveBeenCalled();
  });
});
