import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { RunnerContext } from './action.js';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  notice: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

const REPOSITORY = 'acme/app';

function fragment(platform: string, findings = 0): string {
  return JSON.stringify({
    version: 1,
    platform,
    image: 'app:test',
    size_bytes: 1_048_576,
    warning_mib: 150,
    findings,
    severity: 'CRITICAL,HIGH',
  });
}

let root: string;
let downloads: string;
// One file for the whole suite: `core.summary` resolves GITHUB_STEP_SUMMARY once and caches it.
let summaryDirectory: string;
let summaryFile: string;

beforeAll(async () => {
  summaryDirectory = await mkdtemp(path.join(tmpdir(), 'image-check-summary-step-'));
  summaryFile = path.join(summaryDirectory, 'summary.md');
});

afterAll(async () => {
  await rm(summaryDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'image-check-summary-'));
  downloads = path.join(root, 'downloads');
  await writeFile(summaryFile, '');
  vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile);
  vi.stubEnv('INPUT_DIRECTORY', downloads);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** Lays out artifacts as download-artifact does: one directory each, holding `fragment.json`. */
async function artifacts(files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.join(downloads, name), { recursive: true });
    await writeFile(path.join(downloads, name, 'fragment.json'), content);
  }
}

/** `null` runs outside any pull request, as a push would. */
async function context(headRepository: string | null = REPOSITORY): Promise<RunnerContext> {
  if (headRepository === null) {
    return { repository: REPOSITORY, eventPath: '' };
  }

  const eventPath = path.join(root, 'event.json');
  await writeFile(
    eventPath,
    JSON.stringify({ pull_request: { number: 7, head: { repo: { full_name: headRepository } } } }),
  );

  return { repository: REPOSITORY, eventPath };
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls.map(([name, value]) => [name, String(value)]));
}

describe('run', () => {
  it('renders one row per artifact, sorted, and comments on the pull request', async () => {
    await artifacts({
      'image-check-linux-arm64': fragment('linux/arm64', 2),
      'image-check-linux-amd64': fragment('linux/amd64', 1),
    });

    await run(await context());

    expect(core.setFailed).not.toHaveBeenCalled();
    const result = outputs();
    expect(result['images']).toBe('2');
    expect(result['write_comment']).toBe('true');
    expect(result['body']?.indexOf('linux/amd64')).toBeLessThan(result['body']?.indexOf('linux/arm64') ?? -1);
    expect(await readFile(summaryFile, 'utf8')).toContain('**Docker images**');
  });

  // download-artifact extracts a lone match into the path itself, not a directory named after it.
  it('reads a single artifact extracted straight into the directory', async () => {
    await mkdir(downloads, { recursive: true });
    await writeFile(path.join(downloads, 'fragment.json'), fragment('linux/amd64'));

    await run(await context());

    expect(outputs()['images']).toBe('1');
  });

  it('treats a directory that was never created as no fragments, and warns on a pull request', async () => {
    await run(await context());

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()).toMatchObject({ images: '0', write_comment: 'false' });
    expect(outputs()['body']).toBeUndefined();
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Found no docker/image-check fragments'));
  });

  it('stays silent about an empty directory outside a pull request', async () => {
    await run(await context(null));

    expect(outputs()).toMatchObject({ images: '0', write_comment: 'false' });
    expect(core.warning).not.toHaveBeenCalled();
  });

  it('renders the table but does not comment outside a pull request', async () => {
    await artifacts({ 'image-check-linux-amd64': fragment('linux/amd64') });

    await run(await context(null));

    expect(outputs()).toMatchObject({ images: '1', write_comment: 'false' });
    expect(outputs()['body']).toContain('linux/amd64');
  });

  it('skips the comment on a fork, with a notice', async () => {
    await artifacts({ 'image-check-linux-amd64': fragment('linux/amd64') });

    await run(await context('mallory/app'));

    expect(outputs()['write_comment']).toBe('false');
    expect(core.notice).toHaveBeenCalledWith(expect.stringContaining('GITHUB_TOKEN is read-only'));
  });

  it('warns about a platform described twice, and keeps the last one read', async () => {
    await artifacts({ a: fragment('linux/amd64', 1), b: fragment('linux/amd64', 9) });

    await run(await context());

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('"linux/amd64"'));
    expect(outputs()['images']).toBe('1');
    expect(outputs()['body']).toContain('| `linux/amd64` | 1.0 | 9 |');
  });

  it('fails on an invalid fragment, naming the artifact', async () => {
    await artifacts({ 'image-check-linux-amd64': '{"version":1}' });

    await run(await context());

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('image-check-linux-amd64/fragment.json'));
  });

  it('ignores files that are not JSON', async () => {
    await artifacts({ 'image-check-linux-amd64': fragment('linux/amd64') });
    await writeFile(path.join(downloads, 'image-check-linux-amd64', 'README.txt'), 'not a fragment');

    await run(await context());

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()['images']).toBe('1');
  });
});
