import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { stageBundles } from 'action-graph';
import { runInProcess } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isStrictlyWithin, run } from './action.js';
import { GitBackedApi } from './git-backed-api.js';

import type { PublishOverrides, RunnerContext } from './action.js';
import type { ArtifactRecord, StagedBundles } from 'action-graph';

const DIGEST = 'd'.repeat(64);

let scratch: string;
let api: GitBackedApi;
let source: string;
let staged: StagedBundles;
let notesFile: string;
let context: RunnerContext;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(tmpdir(), 'publish-action-'));
  const temp = path.join(scratch, 'temp');
  const build = path.join(scratch, 'build');
  fs.mkdirSync(path.join(build, 'actions/a/dist'), { recursive: true });
  fs.mkdirSync(temp);
  fs.writeFileSync(path.join(build, 'actions/a/dist/index.js'), 'a();\n');
  api = GitBackedApi.create();
  source = api.commitFiles({ 'actions/a/action.yml': 'runs: {}\n' });
  staged = stageBundles(build, ['actions/a'], ['actions/a/dist/index.js'], path.join(temp, 'download'), {
    sourceSha: source,
    toolchain: 'bun 1.4.4',
    generatedBy: 'test',
  });
  notesFile = path.join(scratch, 'notes.md');
  fs.writeFileSync(notesFile, '* a\n');
  context = { temp, runId: '42' };
});

afterEach(() => {
  api.dispose();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function inputs(change: Record<string, string> = {}): Record<string, string> {
  return {
    token: 'write-token',
    github_token: 'read-token',
    repository: 'o/r',
    source_sha: source,
    artifact_id: '9',
    expected_artifact_digest: DIGEST,
    expected_manifest_sha256: staged.manifestSha256,
    cross_check_manifest_sha256: '',
    allowed_paths: 'actions/**/dist/**',
    existing_files: 'fail',
    releases_branch: 'releases',
    releases: JSON.stringify([
      {
        consumerTag: 'actions-a-v1.0.0',
        sourceTag: 'src-actions-a-v1.0.0',
        releaseName: 'a: v1.0.0',
        notesFile,
        path: 'actions/a',
      },
    ]),
    release_assets: 'checksums',
    make_latest: 'legacy',
    pull_request: '',
    pending_label: 'autorelease: pending',
    tagged_label: 'autorelease: tagged',
    dry_run: 'false',
    directory: staged.directory,
    run_url: 'https://github.com/o/r/actions/runs/42/attempts/1',
    ...change,
  };
}

function record(change: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return { id: 9, expired: false, digest: `sha256:${DIGEST}`, workflow_run: { id: 42 }, ...change };
}

function runMode(mode: string, change: Record<string, string> = {}, overrides: PublishOverrides = {}) {
  return runInProcess({ mode, ...inputs(change) }, () =>
    run(context, { api: () => api, artifactRecord: async () => record(), ...overrides }),
  );
}

describe('prepare', () => {
  it('checks the artifact record with the read token and creates the download directory', async () => {
    const lookup = vi.fn<NonNullable<PublishOverrides['artifactRecord']>>().mockResolvedValue(record());
    const result = await runMode('prepare', {}, { artifactRecord: lookup });

    expect(result.exitCode).toBe(0);
    expect(lookup).toHaveBeenCalledWith('read-token', { owner: 'o', repo: 'r' }, 9);
    expect(result.outputs['artifact_id']).toBe('9');
    expect(path.dirname(result.outputs['directory'])).toBe(context.temp);
    expect(result.masks).toContain('write-token');
  });

  it('fails closed on a digest mismatch', async () => {
    const result = await runMode('prepare', {}, { artifactRecord: async () => record({ digest: 'e'.repeat(64) }) });

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(/has digest e{64}, expected d{64}/);
  });

  it.each([
    [{ cross_check_manifest_sha256: 'a'.repeat(64) }, /The two builds disagree/],
    [{ source_sha: 'main' }, /source-sha must be a full lowercase commit id/],
    [{ expected_manifest_sha256: 'x' }, /expected-manifest-sha256 must be/],
    [{ releases_branch: 'a..b' }, /releases-branch "a\.\.b" is not a valid branch name/],
    [{ allowed_paths: ' ' }, /allowed-paths lists no glob/],
    [{ existing_files: 'overwrite' }, /existing-files must be one of fail, require-identical/],
    [{ release_assets: 'all' }, /release-assets must be one of/],
    [{ make_latest: 'yes' }, /make-latest must be one of/],
    [{ dry_run: 'maybe' }, /dry-run must be one of/],
    [{ pull_request: 'abc' }, /pull-request must be a positive whole number/],
    [{ tagged_label: 'a\nb' }, /tagged-label must be one line/],
    [{ releases: '[]' }, /releases must be a non-empty JSON array/],
    [{ artifact_id: '0' }, /artifact-id must be a positive whole number/],
  ])('fails for %j before reading the artifact record', async (change, message) => {
    const lookup = vi.fn<NonNullable<PublishOverrides['artifactRecord']>>();
    const result = await runMode('prepare', change, { artifactRecord: lookup });

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(message);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('publish', () => {
  it('publishes the verified bundles and reports what it created', async () => {
    const result = await runMode('publish');

    expect(result.exitCode).toBe(0);
    const build = result.outputs['build_sha'];
    expect(await api.resolveRef('tags/actions-a-v1.0.0')).toBe(build);
    expect(await api.resolveRef('tags/src-actions-a-v1.0.0')).toBe(source);
    expect(api.git(['log', '-1', '--format=%B', build])).toContain(
      'Build-Run: https://github.com/o/r/actions/runs/42/attempts/1',
    );
    expect(JSON.parse(result.outputs['created'])).toContain(`commit:${build}`);
    expect(JSON.parse(result.outputs['releases'])).toEqual([
      { tag: 'actions-a-v1.0.0', id: api.releases[0].id, url: api.releases[0].htmlUrl },
    ]);
  });

  it('reports created [] on a second run', async () => {
    await runMode('publish');
    const second = await runMode('publish');

    expect(second.outputs['created']).toBe('[]');
  });

  it('writes nothing in a dry run', async () => {
    const result = await runMode('publish', { dry_run: 'true' });

    expect(result.exitCode).toBe(0);
    expect(result.outputs).toMatchObject({ build_sha: '', created: '[]' });
    expect(api.writes).toEqual([]);
  });

  it('refuses bundles outside allowed-paths', async () => {
    const result = await runMode('publish', { allowed_paths: 'dist/**' });

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(/Bundles outside allowed-paths: actions\/a\/dist\/index\.js/);
    expect(api.writes).toEqual([]);
  });

  it('refuses bundles built from another commit', async () => {
    const other = api.commitFiles({ x: 'y\n' });
    const result = await runMode('publish', { source_sha: other });

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(`not from source-sha ${other}`);
  });

  it('refuses a tampered download before any write', async () => {
    fs.writeFileSync(path.join(staged.directory, 'actions/a/dist/index.js'), 'b();\n');
    const result = await runMode('publish');

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(/has SHA-256 .* the manifest says/);
    expect(api.writes).toEqual([]);
  });

  it('refuses a download directory outside RUNNER_TEMP', async () => {
    const result = await runMode('publish', { directory: scratch });

    expect(result.errors.join('\n')).toMatch(/directory must be the download directory/);
  });

  it('refuses RUNNER_TEMP itself as the download directory', async () => {
    const result = await runMode('publish', { directory: context.temp });

    expect(result.errors.join('\n')).toMatch(/directory must be the download directory/);
    expect(api.writes).toEqual([]);
  });

  it('refuses an unknown mode', async () => {
    const result = await runMode('upload');

    expect(result.errors.join('\n')).toMatch(/mode must be prepare or publish/);
  });
});

describe('isStrictlyWithin', () => {
  it.each([
    ['/runner/temp', '/runner/temp/publish-build-commit-x', true],
    ['/runner/temp', '/runner/temp/..foo', true],
    ['/runner/temp', '/runner/temp', false],
    ['/runner/temp', '/runner', false],
    ['/runner/temp', '/runner/temp-sibling', false],
  ])('POSIX: %s contains %s: %s', (parent, child, expected) => {
    expect(isStrictlyWithin(parent, child, path.posix)).toBe(expected);
  });

  it.each([
    ['C:\\runner\\temp', 'C:\\runner\\temp\\..foo', true],
    ['C:\\runner\\temp', 'C:\\runner\\temp', false],
    // path.relative across drives returns the absolute target.
    ['C:\\runner\\temp', 'D:\\runner\\temp\\x', false],
  ])('Windows: %s contains %s: %s', (parent, child, expected) => {
    expect(isStrictlyWithin(parent, child, path.win32)).toBe(expected);
  });
});
