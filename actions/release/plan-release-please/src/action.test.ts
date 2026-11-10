import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runInProcess } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { ApiFactory } from './action.js';
import type { ReleaseStateApi } from './github.js';

const MERGE = 'a'.repeat(40);
const PARENT = 'b'.repeat(40);
const CONFIG = JSON.stringify({ packages: { 'actions/x': { component: 'src-actions-x' } } });

let temp: string;

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(tmpdir(), 'plan-release-please-'));
});

afterEach(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

const files: Record<string, Record<string, string>> = {
  [PARENT]: { '.release-please-manifest.json': '{"actions/x":"1.0.0"}' },
  [MERGE]: {
    'release-please-config.json': CONFIG,
    '.release-please-manifest.json': '{"actions/x":"1.1.0"}',
    'actions/x/CHANGELOG.md': '# Changelog\n\n## [1.1.0](x) (2026-11-10)\n\n* new\n',
  },
};

function api(isRelease: boolean, tags: string[] = []): ReleaseStateApi {
  return {
    defaultBranch: async () => 'main',
    commitParents: async () => [PARENT],
    fileAt: async (file, ref) => files[ref]?.[file],
    pullRequestsForCommit: async () =>
      isRelease
        ? [
            {
              number: 5,
              mergedAt: 'x',
              mergeCommitSha: MERGE,
              baseRef: 'main',
              authorId: 9,
              labels: ['autorelease: pending'],
            },
          ]
        : [],
    tagsWithPrefix: async () => new Set(tags),
  };
}

const INPUTS = {
  token: 'secret-token',
  sha: MERGE,
  'config-file': 'release-please-config.json',
  'manifest-file': '.release-please-manifest.json',
  'source-tag-prefix': 'src-',
  'consumer-tag-pattern': '^(?:[a-z0-9][a-z0-9-]*-)?v\\d+\\.\\d+\\.\\d+$',
  'release-pr-author-id': '9',
  'pending-label': 'autorelease: pending',
};

function runWith(inputs: Record<string, string>, factory: ApiFactory) {
  return runInProcess({ ...INPUTS, ...inputs }, () => run({ repository: 'owner/repo', temp }, factory));
}

describe('run', () => {
  it('writes each release with its notes file in plan mode', async () => {
    const factory = vi.fn<ApiFactory>().mockReturnValue(api(true));
    const result = await runWith({ mode: 'plan' }, factory);

    expect(result.exitCode).toBe(0);
    expect(factory).toHaveBeenCalledWith('secret-token', { owner: 'owner', repo: 'repo' });
    expect(result.masks).toContain('secret-token');
    expect(result.outputs).toMatchObject({ 'is-release': 'true', 'pull-request': '5' });
    const [release] = JSON.parse(result.outputs['releases']);
    expect(release).toMatchObject({
      path: 'actions/x',
      component: 'src-actions-x',
      consumerTag: 'actions-x-v1.1.0',
      sourceTag: 'src-actions-x-v1.1.0',
      releaseName: 'actions-x: v1.1.0',
    });
    expect(path.dirname(release.notesFile)).toBe(result.outputs['notes-dir']);
    expect(fs.readFileSync(release.notesFile, 'utf8')).toBe('* new\n');
  });

  it('reports a commit that releases nothing', async () => {
    const result = await runWith({ mode: 'plan' }, () => api(false));

    expect(result.outputs).toMatchObject({ 'is-release': 'false', 'pull-request': '', releases: '[]' });
  });

  it('passes preflight when the source tag exists, and fails when it does not', async () => {
    expect((await runWith({ mode: 'preflight' }, () => api(false, ['src-actions-x-v1.1.0']))).exitCode).toBe(0);

    const failed = await runWith({ mode: 'preflight' }, () => api(false));
    expect(failed.exitCode).toBe(1);
    expect(failed.errors.join('\n')).toMatch(/Missing source tags \(1\): src-actions-x-v1\.1\.0/);
  });

  it.each([
    [{ mode: 'release' }, /mode must be preflight or plan/],
    [{ mode: 'plan', sha: 'main' }, /sha must be a full lowercase commit id/],
    [{ mode: 'plan', 'consumer-tag-pattern': '(' }, /consumer-tag-pattern is not a valid regular expression/],
    [{ mode: 'plan', 'release-pr-author-id': 'bot' }, /release-pr-author-id must be empty or a numeric user ID/],
    [{ mode: 'plan', 'source-tag-prefix': 'src//' }, /source-tag-prefix must be/],
    [{ mode: 'plan', 'source-tag-prefix': '-src' }, /source-tag-prefix must be/],
    [{ mode: 'plan', 'config-file': '../x.json' }, /'\.\.' segment/],
  ])('fails for %j without calling the API', async (inputs, message) => {
    const factory = vi.fn<ApiFactory>();
    const result = await runWith(inputs, factory);

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toMatch(message);
    expect(factory).not.toHaveBeenCalled();
  });
});
