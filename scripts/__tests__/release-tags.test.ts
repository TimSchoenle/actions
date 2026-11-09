import { describe, expect, it } from 'vitest';

import {
  expectedReleaseTags,
  gitRunner,
  gitTagRepository,
  parseReleasedPaths,
  readReleaseFiles,
  type ReleaseFiles,
  type TagRepository,
  waitForTags,
  waitReleaseTags,
} from '../lib/release-tags.js';

const FILES: ReleaseFiles = {
  config: {
    packages: {
      'actions/common/read-yaml': { component: 'actions-common-read-yaml', 'include-component-in-tag': true },
      'configs/checkstyle/library': { component: 'configs-checkstyle-library', 'include-component-in-tag': true },
    },
  },
  manifest: { 'actions/common/read-yaml': '2.0.3', 'configs/checkstyle/library': '1.4.0' },
};

/** A repository whose tags become visible on the fetch numbered in `visibleFrom` (1-based). */
function fakeRepository(visibleFrom: Record<string, number>): TagRepository & { fetches: number; sleeps: number[] } {
  const state = {
    fetches: 0,
    sleeps: [] as number[],
    async fetchTags() {
      state.fetches++;
    },
    async hasTag(tag: string) {
      return state.fetches >= (visibleFrom[tag] ?? Number.POSITIVE_INFINITY);
    },
    async sleep(ms: number) {
      state.sleeps.push(ms);
    },
  };

  return state;
}

describe('parseReleasedPaths', () => {
  it('reads the JSON array release-please outputs', () => {
    expect(parseReleasedPaths('["actions/common/read-yaml"]')).toEqual(['actions/common/read-yaml']);
  });

  it('rejects anything but an array of strings', () => {
    expect(() => parseReleasedPaths('not json')).toThrow('not JSON');
    expect(() => parseReleasedPaths('{"a":1}')).toThrow('not an array');
    expect(() => parseReleasedPaths('[1]')).toThrow('not an array');
  });
});

describe('expectedReleaseTags', () => {
  it('names each released path by component and manifest version', () => {
    expect(expectedReleaseTags(FILES, ['actions/common/read-yaml', 'configs/checkstyle/library'])).toEqual([
      'actions-common-read-yaml-v2.0.3',
      'configs-checkstyle-library-v1.4.0',
    ]);
  });

  it('rejects a released path that is not a package', () => {
    expect(() => expectedReleaseTags(FILES, ['actions/common/unknown'])).toThrow(
      'actions/common/unknown was released but is not a package',
    );
  });

  it('rejects config and manifest files that are not JSON objects', () => {
    expect(() => expectedReleaseTags({ ...FILES, config: [] }, [])).toThrow('release-please-config.json');
    expect(() => expectedReleaseTags({ ...FILES, config: {} }, [])).toThrow('Its packages');
    expect(() => expectedReleaseTags({ ...FILES, manifest: null }, [])).toThrow('.release-please-manifest.json');
  });

  it('rejects a package with no component', () => {
    const files = { ...FILES, config: { packages: { 'actions/common/read-yaml': {} } } };

    expect(() => expectedReleaseTags(files, ['actions/common/read-yaml'])).toThrow('has no component');
  });

  it('rejects a package with no version in the manifest', () => {
    const files = { ...FILES, manifest: {} };

    expect(() => expectedReleaseTags(files, ['actions/common/read-yaml'])).toThrow('has no version');
  });

  it('treats a missing include-component-in-tag as true, as release-please does', () => {
    const files = {
      ...FILES,
      config: { packages: { 'actions/common/read-yaml': { component: 'actions-common-read-yaml' } } },
    };

    expect(expectedReleaseTags(files, ['actions/common/read-yaml'])).toEqual(['actions-common-read-yaml-v2.0.3']);
  });

  it('rejects a package whose tag would not carry its component', () => {
    const files = {
      ...FILES,
      config: {
        packages: {
          'actions/common/read-yaml': { component: 'actions-common-read-yaml', 'include-component-in-tag': false },
        },
      },
    };

    expect(() => expectedReleaseTags(files, ['actions/common/read-yaml'])).toThrow('include-component-in-tag');
  });
});

describe('waitForTags', () => {
  it('returns after one fetch when every tag is already there', async () => {
    const repository = fakeRepository({ a: 1, b: 1 });

    await waitForTags(repository, ['a', 'b'], [5, 10]);

    expect(repository.fetches).toBe(1);
    expect(repository.sleeps).toEqual([]);
  });

  it('re-fetches until a late tag appears', async () => {
    const repository = fakeRepository({ a: 1, b: 3 });

    await waitForTags(repository, ['a', 'b'], [5, 10, 20]);

    expect(repository.fetches).toBe(3);
    expect(repository.sleeps).toEqual([5, 10]);
  });

  it('fails at once when the fetch itself fails', async () => {
    const repository = fakeRepository({});
    repository.fetchTags = async () => {
      throw new Error('fetch failed');
    };

    await expect(waitForTags(repository, ['a'], [5, 10])).rejects.toThrow('fetch failed');
    expect(repository.sleeps).toEqual([]);
  });

  it('fails naming the tags still missing after the last retry', async () => {
    const repository = fakeRepository({ a: 1 });

    await expect(waitForTags(repository, ['a', 'b', 'c'], [5, 10])).rejects.toThrow(
      'Release tags still missing after 3 fetches: b, c.',
    );
    expect(repository.sleeps).toEqual([5, 10]);
  });
});

describe('gitTagRepository', () => {
  it('fetches tags from origin and checks a tag by its full ref', async () => {
    const calls: string[][] = [];
    const repository = gitTagRepository(async (args) => {
      calls.push(args);
      return args[0] === 'rev-parse' && args[3] === 'refs/tags/missing' ? 1 : 0;
    });

    await repository.fetchTags();

    expect(await repository.hasTag('present')).toBe(true);
    expect(await repository.hasTag('missing')).toBe(false);
    expect(calls).toEqual([
      ['fetch', '--force', '--tags', '--quiet', 'origin'],
      ['rev-parse', '--verify', '--quiet', 'refs/tags/present'],
      ['rev-parse', '--verify', '--quiet', 'refs/tags/missing'],
    ]);
  });

  it('fails when the fetch exits non-zero', async () => {
    const repository = gitTagRepository(async () => 128);

    await expect(repository.fetchTags()).rejects.toThrow('exit code 128');
  });

  it('sleeps with a real timer by default', async () => {
    const repository = gitTagRepository(async () => 0);

    await expect(repository.sleep(1)).resolves.toBeUndefined();
  });
});

describe('gitRunner', () => {
  it('resolves to the exit code of git', async () => {
    const git = gitRunner();

    expect(await git(['--version'])).toBe(0);
    expect(await git(['rev-parse', '--verify', '--quiet', 'refs/tags/no-such-tag-anywhere'])).not.toBe(0);
  });
});

describe('readReleaseFiles', () => {
  it('reads the config and manifest of this repository', async () => {
    const files = await readReleaseFiles();

    expect(files.config).toHaveProperty('packages');
    expect(files.manifest).toHaveProperty(['actions/common/read-yaml']);
  });
});

describe('waitReleaseTags', () => {
  it('requires the released paths', async () => {
    const io = { releasedPaths: '', readFiles: async () => FILES, repository: fakeRepository({}), log: () => {} };

    await expect(waitReleaseTags(io)).rejects.toThrow('RELEASED_PATHS is required.');
  });

  it('waits for the tags of the released paths', async () => {
    const messages: string[] = [];
    const repository = fakeRepository({ 'actions-common-read-yaml-v2.0.3': 2 });

    await waitReleaseTags(
      {
        releasedPaths: '["actions/common/read-yaml"]',
        readFiles: async () => FILES,
        repository,
        log: (message) => messages.push(message),
      },
      [5],
    );

    expect(repository.fetches).toBe(2);
    expect(messages).toEqual([
      'Waiting for 1 release tag(s): actions-common-read-yaml-v2.0.3',
      'Every release tag is present.',
    ]);
  });
});
