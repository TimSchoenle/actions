import { describe, expect, it } from 'vitest';

import { consumerTagFor, plan, preflight } from './plan.js';

import type { AssociatedPullRequest, ReleaseStateApi } from './github.js';
import type { PlanOptions } from './plan.js';

const MERGE = 'a'.repeat(40);
const PARENT = 'b'.repeat(40);
const AUTHOR = 248313786;

const CONFIG = JSON.stringify({
  packages: {
    'actions/common/x': { component: 'src-actions-common-x' },
    'actions/common/y': { component: 'src-actions-common-y' },
  },
});

const changelog = (version: string) =>
  `# Changelog\n\n## [${version}](https://example.com) (2026-11-10)\n\n* change in ${version}\n`;

/** An in-memory repository: files per ref, pull requests, tags. */
function fakeApi(options: {
  files?: Record<string, Record<string, string>>;
  pulls?: AssociatedPullRequest[];
  tags?: string[];
  parents?: string[];
}): ReleaseStateApi {
  const files = options.files ?? {
    [PARENT]: {
      'release-please-config.json': CONFIG,
      '.release-please-manifest.json': '{"actions/common/x":"1.0.0","actions/common/y":"2.0.0"}',
    },
    [MERGE]: {
      'release-please-config.json': CONFIG,
      '.release-please-manifest.json': '{"actions/common/x":"1.1.0","actions/common/y":"2.0.0"}',
      'actions/common/x/CHANGELOG.md': changelog('1.1.0'),
    },
  };

  return {
    defaultBranch: async () => 'main',
    commitParents: async () => options.parents ?? [PARENT],
    fileAt: async (path, ref) => files[ref]?.[path],
    pullRequestsForCommit: async () => options.pulls ?? [],
    tagsWithPrefix: async (prefix) => new Set((options.tags ?? []).filter((tag) => tag.startsWith(prefix))),
  };
}

function pull(change: Partial<AssociatedPullRequest> = {}): AssociatedPullRequest {
  return {
    number: 12,
    mergedAt: '2026-11-10T00:00:00Z',
    mergeCommitSha: MERGE,
    baseRef: 'main',
    authorId: AUTHOR,
    labels: ['autorelease: pending'],
    ...change,
  };
}

const OPTIONS: PlanOptions = {
  sha: MERGE,
  configFile: 'release-please-config.json',
  manifestFile: '.release-please-manifest.json',
  sourceTagPrefix: 'src-',
  consumerTagPattern: /^(?:actions|configs)-[a-z0-9-]+-v\d+\.\d+\.\d+$/u,
  releasePrAuthorId: AUTHOR,
  pendingLabel: 'autorelease: pending',
};

describe('plan', () => {
  it('plans each changed package with its tags, name and notes', async () => {
    await expect(plan(fakeApi({ pulls: [pull()] }), OPTIONS)).resolves.toEqual({
      isRelease: true,
      pullRequest: 12,
      releases: [
        {
          path: 'actions/common/x',
          component: 'src-actions-common-x',
          version: '1.1.0',
          consumerTag: 'actions-common-x-v1.1.0',
          sourceTag: 'src-actions-common-x-v1.1.0',
          releaseName: 'actions-common-x: v1.1.0',
          notes: '* change in 1.1.0\n',
        },
      ],
    });
  });

  it.each([
    ['no pull request', []],
    ['an unmerged one', [pull({ mergedAt: null })]],
    ['one merged elsewhere', [pull({ mergeCommitSha: PARENT })]],
    ['one into another branch', [pull({ baseRef: 'develop' })]],
    ['one without the pending label', [pull({ labels: ['autorelease: tagged'] })]],
  ])('is not a release for %s', async (_name, pulls) => {
    await expect(plan(fakeApi({ pulls }), OPTIONS)).resolves.toMatchObject({ isRelease: false });
  });

  it('is not a release when the manifest does not change', async () => {
    const files: Record<string, Record<string, string>> = {
      [PARENT]: { '.release-please-manifest.json': '{"actions/common/x":"1.0.0"}' },
      [MERGE]: { '.release-please-manifest.json': '{"actions/common/x":"1.0.0"}' },
    };

    await expect(plan(fakeApi({ files, pulls: [pull()] }), OPTIONS)).resolves.toMatchObject({
      isRelease: false,
      reason: expect.stringContaining('changes no version'),
    });
  });

  it('refuses a pending pull request from another author', async () => {
    await expect(plan(fakeApi({ pulls: [pull({ authorId: 1 })] }), OPTIONS)).rejects.toThrow(
      /opened by user 1, not the release author 248313786/,
    );
  });

  it('accepts any author when none is configured', async () => {
    const result = await plan(fakeApi({ pulls: [pull({ authorId: 1 })] }), {
      ...OPTIONS,
      releasePrAuthorId: undefined,
    });

    expect(result.isRelease).toBe(true);
  });

  it('refuses several pending pull requests for one commit', async () => {
    await expect(plan(fakeApi({ pulls: [pull(), pull({ number: 13 })] }), OPTIONS)).rejects.toThrow(/#12, #13/);
  });

  it('fails when a changed package is not configured', async () => {
    const files: Record<string, Record<string, string>> = {
      [PARENT]: { '.release-please-manifest.json': '{}' },
      [MERGE]: { '.release-please-manifest.json': '{"actions/z":"1.0.0"}', 'release-please-config.json': CONFIG },
    };

    await expect(plan(fakeApi({ files, pulls: [pull()] }), OPTIONS)).rejects.toThrow(
      /actions\/z, which .* does not configure/,
    );
  });

  it('fails when the changelog has no section for the version', async () => {
    const files: Record<string, Record<string, string>> = {
      [PARENT]: { '.release-please-manifest.json': '{}' },
      [MERGE]: {
        '.release-please-manifest.json': '{"actions/common/x":"1.1.0"}',
        'release-please-config.json': CONFIG,
        'actions/common/x/CHANGELOG.md': changelog('1.0.0'),
      },
    };

    await expect(plan(fakeApi({ files, pulls: [pull()] }), OPTIONS)).rejects.toThrow(/no heading for version 1\.1\.0/);
  });

  it('fails on a root commit', async () => {
    await expect(plan(fakeApi({ pulls: [pull()], parents: [] }), OPTIONS)).rejects.toThrow(/has no parent/);
  });
});

describe('preflight', () => {
  const files = {
    [MERGE]: {
      'release-please-config.json': CONFIG,
      '.release-please-manifest.json': '{"actions/common/x":"1.1.0","actions/common/y":"2.0.0"}',
    },
  };

  it('passes when every package has the source tag of its version', async () => {
    const tags = ['src-actions-common-x-v1.1.0', 'src-actions-common-y-v2.0.0', 'actions-common-x-v1.1.0'];

    await expect(preflight(fakeApi({ files, tags }), OPTIONS)).resolves.toEqual([
      'src-actions-common-x-v1.1.0',
      'src-actions-common-y-v2.0.0',
    ]);
  });

  it('lists every missing source tag', async () => {
    await expect(preflight(fakeApi({ files, tags: ['actions-common-x-v1.1.0'] }), OPTIONS)).rejects.toThrow(
      'Missing source tags (2): src-actions-common-x-v1.1.0, src-actions-common-y-v2.0.0.',
    );
  });

  it('fails when a package has no manifest version', async () => {
    const partial = { [MERGE]: { ...files[MERGE], '.release-please-manifest.json': '{"actions/common/x":"1.1.0"}' } };

    await expect(preflight(fakeApi({ files: partial }), OPTIONS)).rejects.toThrow(/no version for actions\/common\/y/);
  });

  it('fails when the configuration file is missing at the commit', async () => {
    await expect(preflight(fakeApi({ files: {} }), OPTIONS)).rejects.toThrow(
      /release-please-config\.json does not exist/,
    );
  });
});

describe('consumerTagFor', () => {
  it('strips the prefix', () => {
    expect(consumerTagFor('src-actions-a-v1.0.0', OPTIONS)).toBe('actions-a-v1.0.0');
    expect(consumerTagFor('src-v1.2.3', { ...OPTIONS, consumerTagPattern: /^v\d+\.\d+\.\d+$/u })).toBe('v1.2.3');
  });

  it.each([
    ['actions-a-v1.0.0', /does not start with "src-"/],
    ['src-other-v1.0.0', /does not match/],
    ['src-actions-a-v1.0.0.lock', /does not match/],
  ])('rejects %s', (tag, message) => {
    expect(() => consumerTagFor(tag, OPTIONS)).toThrow(message);
  });
});
