import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { describePatch, runGit, runGitText, serializeMetadata } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  debug: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

let temp: string;

function outputs(): Record<string, unknown> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls);
}

function failure(): string {
  return String(vi.mocked(core.setFailed).mock.calls[0]?.[0] ?? '');
}

function inputs(values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'verdict-action-'));
  inputs({
    artifact_output: 'artifact_name',
    artifacts: '[]',
    changes_output: 'has_changes',
    max_patch_bytes: '1048576',
    merged_artifact: 'generated-files',
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(temp, { force: true, recursive: true });
});

describe('evaluate', () => {
  it('reports a clean run without a download directory', async () => {
    inputs({
      mode: 'evaluate',
      needs: JSON.stringify({ docs: { outputs: { artifact_name: 'docs', has_changes: 'false' }, result: 'success' } }),
    });

    await run({ temp, workspace: temp });

    expect(failure()).toBe('');
    expect(outputs()).toEqual({
      artifacts: '[]',
      directory: '',
      download_path: '',
      download_pattern: '',
      failed_jobs: '',
      has_pending: 'false',
      pending_jobs: '',
    });
  });

  it('reports failed and pending jobs and creates the download directory', async () => {
    inputs({
      mode: 'evaluate',
      needs: JSON.stringify({
        docs: { outputs: { artifact_name: 'docs', has_changes: 'true' }, result: 'success' },
        lint: { outputs: {}, result: 'failure' },
        lock: { outputs: { artifact_name: 'lock', has_changes: 'true' }, result: 'success' },
      }),
    });

    await run({ temp, workspace: temp });

    const result = outputs();
    expect(failure()).toBe('');
    expect(result['failed_jobs']).toBe('lint');
    expect(result['pending_jobs']).toBe('docs lock');
    expect(result['artifacts']).toBe('["docs","lock"]');
    expect(result['download_pattern']).toBe('{docs,lock}');
    expect(result['download_path']).toBe(result['directory']);
    expect(result['has_pending']).toBe('true');
    expect((await stat(String(result['directory']))).isDirectory()).toBe(true);
  });

  it('fails on an output name GitHub would not accept', async () => {
    inputs({ changes_output: 'has changes', mode: 'evaluate', needs: '{"a":{"result":"success"}}' });

    await run({ temp, workspace: temp });

    expect(failure()).toMatch(/changes_output must be a job output name/);
  });

  it('fails when needs is missing', async () => {
    inputs({ mode: 'evaluate', needs: '' });

    await run({ temp, workspace: temp });

    expect(failure()).toMatch(/needs/);
  });
});

describe('inspect and apply', () => {
  let repository: string;
  let downloads: string;

  beforeEach(async () => {
    repository = path.join(temp, 'repo');
    downloads = path.join(temp, 'downloads');
    await mkdir(repository);
    await mkdir(path.join(downloads, 'docs'), { recursive: true });
    await runGit(['init', '--quiet'], { cwd: repository });
    await runGit(['config', 'core.autocrlf', 'false'], { cwd: repository });
    await writeFile(path.join(repository, 'README.md'), 'old\n');
    await runGit(['add', '--all'], { cwd: repository });
    await runGit(['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'seed'], {
      cwd: repository,
    });

    await writeFile(path.join(repository, 'README.md'), 'new\n');
    const patch = await runGit(['diff', '--binary', '--full-index', '--src-prefix=a/', '--dst-prefix=b/'], {
      cwd: repository,
    });
    await runGit(['checkout', '--quiet', '--', 'README.md'], { cwd: repository });

    const head = await runGitText(['rev-parse', 'HEAD'], { cwd: repository });
    await writeFile(path.join(downloads, 'docs', 'changes.patch'), patch);
    await writeFile(path.join(downloads, 'docs', 'metadata.json'), serializeMetadata(describePatch(head, patch)));
    inputs({ artifacts: '["docs"]', directory: downloads });
  });

  it('inspect reports the base the patches share', async () => {
    inputs({ mode: 'inspect' });

    await run({ temp, workspace: repository });

    expect(failure()).toBe('');
    expect(outputs()['base_sha']).toBe(await runGitText(['rev-parse', 'HEAD'], { cwd: repository }));
  });

  it('apply writes the patches into the checkout', async () => {
    inputs({ mode: 'apply' });

    await run({ temp, workspace: repository });

    expect(failure()).toBe('');
    expect(await readFile(path.join(repository, 'README.md'), 'utf8')).toBe('new\n');
  });

  it('refuses an artifacts input that is not a JSON array of names', async () => {
    inputs({ artifacts: '"docs"', mode: 'inspect' });

    await run({ temp, workspace: repository });

    expect(failure()).toMatch(/artifacts must be a JSON array/);
  });
});

it('fails on an unknown mode', async () => {
  inputs({ mode: 'merge' });

  await run({ temp, workspace: temp });

  expect(failure()).toMatch(/mode must be evaluate, inspect or apply/);
});
