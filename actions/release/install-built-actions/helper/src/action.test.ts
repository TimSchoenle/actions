import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CHECKSUMS_FILE, MANIFEST_FILE, sha256Hex, stageBundles } from 'action-graph';
import { runInProcess } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MANIFEST_ENV, run } from './action.js';

import type { RunnerContext } from './action.js';
import type { ArtifactLookup } from './artifact-api.js';
import type { ArtifactRecord, StagedBundles } from 'action-graph';

const DIGEST = 'e'.repeat(64);

let scratch: string;
let context: RunnerContext;
let staged: StagedBundles;

function write(root: string, file: string, content: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(tmpdir(), 'install-built-actions-'));
  const workspace = path.join(scratch, 'workspace');
  const temp = path.join(scratch, 'temp');
  const build = path.join(scratch, 'build');
  const envFile = path.join(scratch, 'github-env');
  fs.mkdirSync(temp, { recursive: true });
  fs.writeFileSync(envFile, '');
  write(build, 'actions/a/dist/index.js', 'fresh();\n');
  write(workspace, 'actions/a/dist/index.js', 'stale();\n');
  write(workspace, 'actions/a/dist/stale-chunk.js', 'stale();\n');
  write(workspace, 'actions/a/src/action.ts', 'source');
  fs.mkdirSync(path.join(workspace, 'nested'), { recursive: true });
  staged = stageBundles(build, ['actions/a'], ['actions/a/dist/index.js'], path.join(temp, 'download'), {
    sourceSha: 'a'.repeat(40),
    toolchain: 'bun 1.4.4',
    generatedBy: 'test',
  });
  context = { workspace, temp, runId: '42', envFile };
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const COMMON = { artifact_id: '7', repository: 'owner/repo', path: '.', replace: 'true' };

function prepare(inputs: Record<string, string> = {}, lookup?: ArtifactLookup) {
  return runInProcess(
    {
      ...COMMON,
      mode: 'prepare',
      expected_manifest_sha256: staged.manifestSha256,
      expected_artifact_digest: '',
      run_id: '',
      token: '',
      ...inputs,
    },
    () => run(context, lookup === undefined ? {} : { lookup: () => lookup }),
  );
}

function install(inputs: Record<string, string> = {}) {
  return runInProcess(
    {
      ...COMMON,
      mode: 'install',
      expected_manifest_sha256: staged.manifestSha256,
      directory: staged.directory,
      ...inputs,
    },
    () => run(context),
  );
}

function record(change: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return { id: 7, expired: false, digest: `sha256:${DIGEST}`, workflow_run: { id: 42 }, ...change };
}

describe('prepare', () => {
  it('validates the inputs and creates an empty download directory for this run', async () => {
    const result = await prepare();

    expect(result.exitCode).toBe(0);
    expect(result.outputs).toMatchObject({ artifact_id: '7', run_id: '42' });
    expect(path.dirname(result.outputs['directory'])).toBe(context.temp);
    expect(fs.readdirSync(result.outputs['directory'])).toEqual([]);
  });

  it('checks the artifact record when a digest is expected', async () => {
    const lookup = vi.fn<ArtifactLookup>().mockResolvedValue(record());
    const result = await prepare({ expected_artifact_digest: DIGEST, token: 'tok' }, lookup);

    expect(result.exitCode).toBe(0);
    expect(lookup).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 7);
  });

  it('checks the record against the named run', async () => {
    const lookup = vi.fn<ArtifactLookup>().mockResolvedValue(record({ workflow_run: { id: 99 } }));

    expect((await prepare({ expected_artifact_digest: DIGEST, token: 'tok', run_id: '99' }, lookup)).exitCode).toBe(0);
  });

  it('fails closed on a digest mismatch, before any download directory exists', async () => {
    const lookup = vi.fn<ArtifactLookup>().mockResolvedValue(record({ digest: `sha256:${'f'.repeat(64)}` }));
    const result = await prepare({ expected_artifact_digest: DIGEST, token: 'tok' }, lookup);

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(/has digest f{64}, expected e{64}/);
    expect(result.outputs).toEqual({});
  });

  it.each([
    [{ artifact_id: 'abc' }, /artifact-id must be a positive whole number/],
    [{ artifact_id: '0' }, /artifact-id must be a positive whole number/],
    [{ expected_manifest_sha256: 'ABC' }, /expected-manifest-sha256 must be/],
    [{ replace: 'maybe' }, /replace must be true or false/],
    [{ path: '../outside' }, /'\.\.' segment/],
    [{ path: 'missing' }, /is not a directory of the workspace/],
    [{ run_id: '5' }, /run-id names another run/],
    [{ expected_artifact_digest: DIGEST }, /needs github-token/],
    [{ repository: 'not-a-repo' }, /Invalid repository/],
    [{ mode: 'download' }, /mode must be prepare or install/],
  ])('fails for %j', async (inputs, message) => {
    const result = await prepare(inputs);

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(message);
  });
});

describe('install', () => {
  it('installs verified bundles, clears stale output and exports the manifest path', async () => {
    const result = await install();
    const workspace = context.workspace;

    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(workspace, 'actions/a/dist/index.js'), 'utf8')).toBe('fresh();\n');
    expect(fs.existsSync(path.join(workspace, 'actions/a/dist/stale-chunk.js'))).toBe(false);
    expect(fs.existsSync(path.join(workspace, 'actions/a/src/action.ts'))).toBe(true);
    const manifestPath = path.join(staged.directory, MANIFEST_FILE);
    expect(result.outputs).toEqual({ manifest_path: manifestPath, bundles: '["actions/a/dist/index.js"]' });
    expect(fs.readFileSync(context.envFile as string, 'utf8')).toBe(`${MANIFEST_ENV}=${manifestPath}\n`);
  });

  it('keeps sibling files without replace', async () => {
    expect((await install({ replace: 'false' })).exitCode).toBe(0);
    expect(fs.existsSync(path.join(context.workspace, 'actions/a/dist/stale-chunk.js'))).toBe(true);
  });

  it('installs into a checkout below the workspace', async () => {
    fs.mkdirSync(path.join(context.workspace, 'nested/actions'), { recursive: true });
    const result = await install({ path: 'nested' });

    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(context.workspace, 'nested/actions/a/dist/index.js'), 'utf8')).toBe('fresh();\n');
  });

  /** Asserts the run failed with `message` and left the checkout exactly as it was. */
  async function expectRefused(inputs: Record<string, string>, message: RegExp): Promise<void> {
    const result = await install(inputs);

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(message);
    expect(fs.readFileSync(path.join(context.workspace, 'actions/a/dist/index.js'), 'utf8')).toBe('stale();\n');
    expect(fs.existsSync(path.join(context.workspace, 'actions/a/dist/stale-chunk.js'))).toBe(true);
  }

  it('fails closed on a wrong manifest hash', async () => {
    await expectRefused({ expected_manifest_sha256: sha256Hex('other') }, /bundles\.json has SHA-256/);
  });

  it('fails closed on an extra file', async () => {
    write(staged.directory, 'actions/a/dist/extra.js', 'evil();');
    await expectRefused({}, /does not list: actions\/a\/dist\/extra\.js/);
  });

  it('fails closed on a symbolic link', async () => {
    fs.symlinkSync('/etc/passwd', path.join(staged.directory, 'actions/a/dist/link.js'));
    await expectRefused({}, /symbolic link/);
  });

  it('fails closed on a missing bundle', async () => {
    fs.rmSync(path.join(staged.directory, 'actions/a/dist/index.js'));
    await expectRefused({}, /missing files the manifest lists/);
  });

  it('fails closed on tampered content', async () => {
    fs.writeFileSync(path.join(staged.directory, 'actions/a/dist/index.js'), 'evil(1);\n');
    await expectRefused({}, /has SHA-256 .* the manifest says/);
  });

  it('fails closed on a tampered checksum list', async () => {
    fs.writeFileSync(path.join(staged.directory, CHECKSUMS_FILE), 'x');
    await expectRefused({}, /bundles\.sha256 does not match/);
  });

  it('fails closed on a manifest path with a .. segment', async () => {
    const manifest = `${JSON.stringify({
      schema: 1,
      sourceSha: 'a'.repeat(40),
      toolchain: '',
      generatedBy: 'test',
      buildDirs: ['actions/a'],
      files: [{ path: 'actions/a/../../../escape.js', sha256: sha256Hex(''), size: 0 }],
    })}\n`;
    fs.writeFileSync(path.join(staged.directory, MANIFEST_FILE), manifest);
    await expectRefused({ expected_manifest_sha256: sha256Hex(manifest) }, /'\.\.' segment/);
  });

  it('refuses a download directory outside RUNNER_TEMP', async () => {
    await expectRefused({ directory: context.workspace }, /directory must be the download directory/);
  });
});
