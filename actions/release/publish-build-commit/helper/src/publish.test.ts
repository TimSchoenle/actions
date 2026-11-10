import { renderChecksums, sha256Hex } from 'action-graph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitBackedApi } from './git-backed-api.js';
import { buildCommitMessage, CHECKSUMS_ASSET, commentMarker, Publisher, releaseAssets } from './publish.js';

import type { PublishRequest, ReleaseSpec } from './publish.js';
import type { BundleFile } from 'action-graph';

const BUNDLES: Record<string, string> = {
  'actions/a/dist/index.js': 'a();\n',
  'actions/b/helper/dist/index.js': 'b();\n',
};

const SOURCE_FILES = {
  'actions/a/action.yml': 'runs: {}\n',
  'actions/a/src/action.ts': 'source\n',
  'actions/b/action.yml': 'runs: {}\n',
  'README.md': 'readme\n',
};

let api: GitBackedApi;
let source: string;

beforeEach(() => {
  api = GitBackedApi.create();
  source = api.commitFiles(SOURCE_FILES);
});

afterEach(() => {
  api.dispose();
});

function files(bundles: Record<string, string>): BundleFile[] {
  return Object.entries(bundles)
    .map(([path, content]) => ({ path, sha256: sha256Hex(content), size: Buffer.byteLength(content) }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

const RELEASES: ReleaseSpec[] = [
  {
    consumerTag: 'actions-a-v1.1.0',
    sourceTag: 'src-actions-a-v1.1.0',
    releaseName: 'actions-a: v1.1.0',
    notes: '* a\n',
    path: 'actions/a',
  },
  {
    consumerTag: 'actions-b-v2.0.0',
    sourceTag: 'src-actions-b-v2.0.0',
    releaseName: 'actions-b: v2.0.0',
    notes: '* b\n',
    path: 'actions/b',
  },
];

function request(overrides: Partial<PublishRequest> = {}, bundles = BUNDLES): PublishRequest {
  return {
    sourceSha: source,
    files: files(bundles),
    readFile: (path) => Buffer.from(bundles[path]),
    manifestSha256: 'f'.repeat(64),
    existingFiles: 'fail',
    releasesBranch: 'releases',
    releases: RELEASES,
    assets: 'checksums',
    makeLatest: 'legacy',
    pullRequest: 7,
    pendingLabel: 'autorelease: pending',
    taggedLabel: 'autorelease: tagged',
    dryRun: false,
    runUrl: 'https://github.com/o/r/actions/runs/1/attempts/1',
    ...overrides,
  };
}

function publish(overrides: Partial<PublishRequest> = {}, bundles = BUNDLES) {
  return new Publisher(api, request(overrides, bundles)).publish();
}

describe('Publisher', () => {
  beforeEach(() => {
    api.labels.set(7, new Set(['autorelease: pending']));
  });

  it('publishes a build commit that only adds the bundles, with tags, releases and labels', async () => {
    const result = await publish();
    const build = result.buildSha as string;
    const commit = await api.getCommit(build);

    expect(commit.parents).toEqual([source]);
    expect(commit.tree).toBe(result.treeSha);
    expect(api.git(['diff-tree', '-r', '--no-commit-id', '--name-status', source, build]).split('\n')).toEqual([
      'A\tactions/a/dist/index.js',
      'A\tactions/b/helper/dist/index.js',
    ]);
    expect(api.show(build, 'actions/a/dist/index.js')).toBe('a();');
    expect(api.git(['log', '-1', '--format=%B', build])).toBe(buildCommitMessage(request()).trim());

    expect(await api.resolveRef('heads/releases')).toBe(build);
    expect(await api.resolveRef('tags/actions-a-v1.1.0')).toBe(build);
    expect(await api.resolveRef('tags/actions-b-v2.0.0')).toBe(build);
    expect(await api.resolveRef('tags/src-actions-a-v1.1.0')).toBe(source);

    expect(
      api.releases.map(({ tagName, draft, name, body, makeLatest }) => ({ tagName, draft, name, body, makeLatest })),
    ).toEqual([
      { tagName: 'actions-a-v1.1.0', draft: false, name: 'actions-a: v1.1.0', body: '* a\n', makeLatest: 'legacy' },
      { tagName: 'actions-b-v2.0.0', draft: false, name: 'actions-b: v2.0.0', body: '* b\n', makeLatest: 'legacy' },
    ]);
    expect(api.releases[0].assetContents.get(CHECKSUMS_ASSET)?.toString()).toBe(
      renderChecksums(files({ 'actions/a/dist/index.js': 'a();\n' })),
    );
    expect(result.releases).toEqual([
      { tag: 'actions-a-v1.1.0', id: api.releases[0].id, url: api.releases[0].htmlUrl },
      { tag: 'actions-b-v2.0.0', id: api.releases[1].id, url: api.releases[1].htmlUrl },
    ]);

    expect([...(api.labels.get(7) ?? [])]).toEqual(['autorelease: tagged']);
    expect(api.comments.get(7)?.[0]).toContain(commentMarker(source));
    expect(result.created).toEqual([
      `commit:${build}`,
      `branch:releases@${build}`,
      `tag:actions-a-v1.1.0@${build}`,
      `tag:src-actions-a-v1.1.0@${source}`,
      `tag:actions-b-v2.0.0@${build}`,
      `tag:src-actions-b-v2.0.0@${source}`,
      'release:actions-a-v1.1.0',
      `asset:actions-a-v1.1.0/${CHECKSUMS_ASSET}`,
      'published:actions-a-v1.1.0',
      'release:actions-b-v2.0.0',
      `asset:actions-b-v2.0.0/${CHECKSUMS_ASSET}`,
      'published:actions-b-v2.0.0',
      'comment:#7',
      'label:#7+autorelease: tagged',
      'label:#7-autorelease: pending',
    ]);
  });

  it('is a no-op on a second run', async () => {
    const first = await publish();
    api.writes.length = 0;

    const second = await publish();

    expect(second).toEqual({ ...first, created: [] });
    expect(api.writes).toEqual([]);
  });

  it('chains the next build commit on the releases branch', async () => {
    const first = (await publish()).buildSha as string;
    source = api.commitFiles({ ...SOURCE_FILES, 'README.md': 'changed\n' }, source);
    const next = await publish({
      releases: [{ ...RELEASES[0], consumerTag: 'actions-a-v1.2.0', sourceTag: 'src-actions-a-v1.2.0' }],
    });

    expect((await api.getCommit(next.buildSha as string)).parents).toEqual([first, source]);
    expect(await api.resolveRef('heads/releases')).toBe(next.buildSha);
  });

  it('retries when the releases branch moves between reading and updating it', async () => {
    const first = (await publish()).buildSha as string;
    const other = api.commitFiles({ unrelated: 'x\n' }, first);
    source = api.commitFiles({ ...SOURCE_FILES, 'README.md': 'changed\n' }, source);
    let moved = false;
    api.beforeUpdateRef = (ref) => {
      if (!moved && ref === 'heads/releases') {
        moved = true;
        api.git(['update-ref', 'refs/heads/releases', other]);
      }
    };

    const next = await publish({
      releases: [{ ...RELEASES[0], consumerTag: 'actions-a-v1.2.0', sourceTag: 'src-actions-a-v1.2.0' }],
    });

    expect((await api.getCommit(next.buildSha as string)).parents).toEqual([other, source]);
    expect(await api.resolveRef('heads/releases')).toBe(next.buildSha);
  });

  it('fails on a tag that exists at another commit, before creating any release', async () => {
    api.git(['update-ref', 'refs/tags/actions-b-v2.0.0', source]);

    await expect(publish()).rejects.toThrow(/Tag actions-b-v2\.0\.0 exists at .*, which is not a build commit/);
    expect(api.releases).toEqual([]);
    expect(await api.resolveRef('heads/releases')).toBeUndefined();
  });

  it('fails on a source tag that exists at another commit', async () => {
    const elsewhere = api.commitFiles({ x: 'y\n' });
    api.git(['update-ref', 'refs/tags/src-actions-a-v1.1.0', elsewhere]);

    await expect(publish()).rejects.toThrow(`Tag src-actions-a-v1.1.0 exists at ${elsewhere}, expected ${source}.`);
  });

  it('writes nothing in a dry run, and reports the tree the real run creates', async () => {
    const dry = await publish({ dryRun: true });

    expect(api.writes).toEqual([]);
    expect(dry.buildSha).toBeUndefined();
    expect(dry.created).toEqual([]);
    expect((await publish()).treeSha).toBe(dry.treeSha);
  });

  it('reuses the branch head when a run failed after moving the branch, before the tags', async () => {
    const tree = (await publish({ dryRun: true })).treeSha;
    const orphan = await api.createCommit('earlier attempt', await commitTree(), [source]);
    api.git(['update-ref', 'refs/heads/releases', orphan]);
    api.writes.length = 0;

    const result = await publish();

    expect(result.buildSha).toBe(orphan);
    expect(result.treeSha).toBe(tree);
    expect(api.writes.filter((write) => write === 'commit')).toEqual([]);

    async function commitTree(): Promise<string> {
      return api.createTree(
        (await api.getCommit(source)).tree,
        files(BUNDLES).map((file) => ({
          path: file.path,
          sha: api.git(['hash-object', '-w', '--stdin'], BUNDLES[file.path]),
        })),
      );
    }
  });

  it('completes a draft left by a failed run, replacing its assets', async () => {
    const tagged = await publish({ releases: [RELEASES[1]], pullRequest: undefined });
    const draft = await api.createDraftRelease('actions-a-v1.1.0', 'old name', 'old');
    await api.uploadAsset(draft, 'stale.txt', Buffer.from('stale'));
    await api.uploadAsset(draft, CHECKSUMS_ASSET, Buffer.from('wrong'));

    const result = await publish();

    const completed = api.releases.find((release) => release.id === draft.id);
    expect(completed).toMatchObject({ draft: false, name: 'actions-a: v1.1.0', body: '* a\n' });
    expect([...(completed?.assetContents.keys() ?? [])]).toEqual([CHECKSUMS_ASSET]);
    expect(api.releases.filter((release) => release.tagName === 'actions-a-v1.1.0')).toHaveLength(1);
    expect(result.buildSha).toBe(tagged.buildSha);
  });

  it('leaves a published release alone', async () => {
    await publish();
    const before = JSON.stringify(api.releases);

    await publish();

    expect(JSON.stringify(api.releases)).toBe(before);
  });

  it('refuses two drafts for one tag', async () => {
    await api.createDraftRelease('actions-a-v1.1.0', 'x', 'x');
    await api.createDraftRelease('actions-a-v1.1.0', 'y', 'y');

    await expect(publish()).rejects.toThrow(/has 2 draft releases/);
  });

  it('gives the build commit the source commit as its only parent without a releases branch', async () => {
    const first = await publish({ releasesBranch: '' });

    expect((await api.getCommit(first.buildSha as string)).parents).toEqual([source]);
    expect(await api.resolveRef('heads/releases')).toBeUndefined();
    api.writes.length = 0;
    expect((await publish({ releasesBranch: '' })).created).toEqual([]);
    expect(api.writes).toEqual([]);
  });

  it('fast-forwards a releases branch that is behind an existing build commit', async () => {
    const first = (await publish()).buildSha as string;
    api.git(['update-ref', 'refs/heads/releases', source]);

    const again = await publish();

    expect(again.created).toEqual([`branch:releases@${first}`]);
    expect(await api.resolveRef('heads/releases')).toBe(first);
  });

  it('refuses a releases branch that has diverged from the build commit', async () => {
    await publish();
    api.git(['update-ref', 'refs/heads/releases', api.commitFiles({ other: 'x\n' })]);

    await expect(publish()).rejects.toThrow(/does not contain the build commit/);
  });

  describe('existing bundles in the source commit', () => {
    it('are refused under fail', async () => {
      source = api.commitFiles({ ...SOURCE_FILES, 'actions/a/dist/index.js': 'a();\n' });

      await expect(publish()).rejects.toThrow(/actions\/a\/dist\/index\.js already exists in the source commit/);
    });

    it('are accepted when identical under require-identical, leaving the tree unchanged', async () => {
      source = api.commitFiles({ ...SOURCE_FILES, ...BUNDLES });
      const result = await publish({ existingFiles: 'require-identical' });

      expect(result.treeSha).toBe((await api.getCommit(source)).tree);
      expect(api.writes).not.toContain('tree');
    });

    it('are refused when different under require-identical', async () => {
      source = api.commitFiles({ ...SOURCE_FILES, 'actions/a/dist/index.js': 'stale();\n' });

      await expect(publish({ existingFiles: 'require-identical' })).rejects.toThrow(
        /exists in the source commit with other content/,
      );
    });

    it('are refused where the source has a directory', async () => {
      source = api.commitFiles({ ...SOURCE_FILES, 'actions/a/dist/index.js/inner': 'x\n' });

      await expect(publish({ existingFiles: 'require-identical' })).rejects.toThrow(
        /exists in the source commit as a directory/,
      );
    });

    it('are refused where the source has a file on the path', async () => {
      source = api.commitFiles({ ...SOURCE_FILES, 'actions/a/dist': 'x\n' });

      await expect(publish()).rejects.toThrow(/actions\/a\/dist exists in the source commit as a file/);
    });
  });
});

describe('releaseAssets', () => {
  const read = (path: string) => Buffer.from(BUNDLES[path]);
  const base = { files: files(BUNDLES), readFile: read };

  it('lists the bundles below the release path, then the bundles themselves', () => {
    expect(releaseAssets(RELEASES[1], { ...base, assets: 'bundles' }).map((asset) => asset.name)).toEqual([
      CHECKSUMS_ASSET,
      'helper-dist-index.js',
    ]);
  });

  it('covers every bundle for a release without a path, and none for policy none', () => {
    const all = releaseAssets({ ...RELEASES[0], path: undefined }, { ...base, assets: 'checksums' });

    expect(all[0].content.toString()).toBe(renderChecksums(files(BUNDLES)));
    expect(releaseAssets(RELEASES[0], { ...base, assets: 'none' })).toEqual([]);
  });

  it('has no assets for a release whose path holds no bundle', () => {
    expect(releaseAssets({ ...RELEASES[0], path: 'actions/c' }, { ...base, assets: 'bundles' })).toEqual([]);
  });

  it('refuses two assets with one name', () => {
    const clashing = { 'x/a-b/c.js': '1', 'x/a/b-c.js': '2' };

    expect(() =>
      releaseAssets(
        { ...RELEASES[0], path: 'x' },
        {
          files: files(clashing),
          readFile: (path) => Buffer.from(clashing[path as keyof typeof clashing]),
          assets: 'bundles',
        },
      ),
    ).toThrow(/two assets named a-b-c\.js/);
  });
});
