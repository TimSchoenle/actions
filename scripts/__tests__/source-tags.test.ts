import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeDecision, main, parseArgs } from '../bootstrap-source-tags.js';
import { readReleaseFiles } from '../lib/release-tags.js';
import {
  checkoutSourceTagGit,
  gitCapture,
  packageVersions,
  planSourceTags,
  tagsToCreate,
  type SourceTagDecision,
} from '../lib/source-tags.js';

let root: string;

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  }).trim();
}

/** Commits the config and manifest for `packages` (path to [component, version]) and returns the commit. */
function commitPackages(packages: Record<string, [string, string]>, message = 'change'): string {
  const config = {
    packages: Object.fromEntries(
      Object.entries(packages).map(([key, [component]]) => [key, { 'release-type': 'simple', component }]),
    ),
  };
  const manifest = Object.fromEntries(Object.entries(packages).map(([key, [, version]]) => [key, version]));
  fs.writeFileSync(path.join(root, 'release-please-config.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(root, '.release-please-manifest.json'), JSON.stringify(manifest, null, 2));
  git('add', '-A');
  git('commit', '--quiet', '--allow-empty', '-m', message);

  return git('rev-parse', 'HEAD');
}

function emptyCommit(message: string): string {
  git('commit', '--quiet', '--allow-empty', '-m', message);
  return git('rev-parse', 'HEAD');
}

async function plan(): Promise<SourceTagDecision[]> {
  return planSourceTags(await readReleaseFiles(root), checkoutSourceTagGit(gitCapture(root)));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), 'source-tags-'));
  git('init', '--quiet', '--initial-branch=main');
  emptyCommit('root');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const A = 'actions/common/a';
const B = 'actions/common/b';

describe('planSourceTags', () => {
  it('puts the source tag of a pre-cutover release on the commit its consumer tag points at', async () => {
    const released = commitPackages({ [A]: ['src-actions-common-a', '1.2.0'] }, 'chore: release main');
    git('tag', 'actions-common-a-v1.2.0', released);
    emptyCommit('feat: later work');

    expect(await plan()).toEqual([
      { kind: 'create', path: A, tag: 'src-actions-common-a-v1.2.0', sha: released, reason: 'released' },
    ]);
  });

  it('accepts a component without the source prefix, as the config had before the cutover', async () => {
    const released = commitPackages({ [A]: ['actions-common-a', '1.2.0'] });
    git('tag', 'actions-common-a-v1.2.0', released);

    expect(tagsToCreate(await plan())).toEqual([{ tag: 'src-actions-common-a-v1.2.0', sha: released }]);
  });

  it('peels an annotated consumer tag to its commit', async () => {
    const released = commitPackages({ [A]: ['src-actions-common-a', '1.2.0'] });
    git('tag', '-a', '-m', 'annotated', 'actions-common-a-v1.2.0', released);

    expect(tagsToCreate(await plan())).toEqual([{ tag: 'src-actions-common-a-v1.2.0', sha: released }]);
  });

  it('leaves a source tag that already exists in the history alone', async () => {
    const released = commitPackages({ [A]: ['src-actions-common-a', '1.2.0'] });
    git('tag', 'src-actions-common-a-v1.2.0', released);
    git('tag', 'actions-common-a-v1.2.0', released);

    expect(await plan()).toEqual([{ kind: 'present', path: A, tag: 'src-actions-common-a-v1.2.0', sha: released }]);
  });

  it('reports a source tag outside the history instead of planning a second one', async () => {
    commitPackages({ [A]: ['src-actions-common-a', '1.2.0'] });
    git('checkout', '--quiet', '--orphan', 'elsewhere');
    const stray = emptyCommit('stray');
    git('tag', 'src-actions-common-a-v1.2.0', stray);
    git('checkout', '--quiet', 'main');

    const [decision] = await plan();

    expect(decision.kind).toBe('unresolved');
    expect(describeDecision(decision)).toContain('not in the default branch');
  });

  it('reports a consumer tag on a build commit whose source tag is missing', async () => {
    const source = commitPackages({ [A]: ['src-actions-common-a', '1.3.0'] });
    git('checkout', '--quiet', '-b', 'releases');
    const build = emptyCommit('build');
    git('tag', 'actions-common-a-v1.3.0', build);
    git('checkout', '--quiet', 'main');

    const [decision] = await plan();

    expect(source).not.toBe(build);
    expect(decision).toMatchObject({ kind: 'unresolved', tag: 'src-actions-common-a-v1.3.0' });
    expect(describeDecision(decision)).toContain('Re-run the publish job');
  });

  it('puts the source tag of a never-released package on the parent of the commit that added it', async () => {
    const before = commitPackages({ [A]: ['src-actions-common-a', '1.2.0'] });
    git('tag', 'src-actions-common-a-v1.2.0', before);
    commitPackages({ [A]: ['src-actions-common-a', '1.2.0'], [B]: ['src-actions-common-b', '1.0.0'] }, 'feat: add b');
    emptyCommit('fix: touch b');

    expect(tagsToCreate(await plan())).toEqual([{ tag: 'src-actions-common-b-v1.0.0', sha: before }]);
  });

  it('does not mistake a package whose first release is in flight for a never-released one', async () => {
    commitPackages({ [B]: ['src-actions-common-b', '1.0.0'] }, 'feat: add b');
    commitPackages({ [B]: ['src-actions-common-b', '1.1.0'] }, 'chore: release main');

    const [decision] = await plan();

    expect(decision).toMatchObject({ kind: 'unresolved', tag: 'src-actions-common-b-v1.1.0' });
    expect(describeDecision(decision)).toContain('in flight');
  });

  it('does not tag a package that has earlier releases but none for its current version', async () => {
    const first = commitPackages({ [A]: ['src-actions-common-a', '1.2.0'] });
    git('tag', 'actions-common-a-v1.2.0', first);
    commitPackages({ [A]: ['src-actions-common-a', '1.3.0'] }, 'chore: release main');

    const [decision] = await plan();

    expect(decision).toMatchObject({ kind: 'unresolved', tag: 'src-actions-common-a-v1.3.0' });
  });

  it('does not take a tag of a package whose name extends this one as its own', async () => {
    commitPackages({ [A]: ['src-actions-common-a', '1.0.0'] }, 'feat: add a');
    git('tag', 'actions-common-a-extra-v2.0.0');

    expect(tagsToCreate(await plan())).toHaveLength(1);
  });

  it('reports a package added in a root commit, which has no parent to tag', async () => {
    fs.rmSync(path.join(root, '.git'), { recursive: true });
    git('init', '--quiet', '--initial-branch=main');
    commitPackages({ [A]: ['src-actions-common-a', '1.0.0'] }, 'root');

    const [decision] = await plan();

    expect(decision).toMatchObject({ kind: 'unresolved' });
    expect(describeDecision(decision)).toContain('root commit');
  });
});

describe('packageVersions', () => {
  it('rejects a package without a component or a version', () => {
    expect(() => packageVersions({ config: { packages: { [A]: {} } }, manifest: { [A]: '1.0.0' } })).toThrow(
      'has no component',
    );
    expect(() => packageVersions({ config: { packages: { [A]: { component: 'c' } } }, manifest: {} })).toThrow(
      'has no version',
    );
    expect(() => packageVersions({ config: [], manifest: {} })).toThrow('not a JSON object');
  });
});

describe('bootstrap-source-tags', () => {
  it('parses its flags and rejects anything else', () => {
    expect(parseArgs([])).toEqual({ output: undefined, strict: false });
    expect(parseArgs(['--output', 'out.json', '--strict'])).toEqual({ output: 'out.json', strict: true });
    expect(() => parseArgs(['--output'])).toThrow('Usage');
    expect(() => parseArgs(['--output', 'a', '--output', 'b'])).toThrow('Usage');
    expect(() => parseArgs(['--apply'])).toThrow('Usage');
  });

  it('writes the tags to create and fails under --strict only when something is unresolved', async () => {
    commitPackages({ [A]: ['src-actions-common-a', '1.1.0'], [B]: ['src-actions-common-b', '1.0.0'] }, 'feat: add');
    const released = commitPackages({ [A]: ['src-actions-common-a', '1.2.0'], [B]: ['src-actions-common-b', '1.1.0'] });
    git('tag', 'actions-common-a-v1.2.0', released);
    const written: Record<string, string> = {};
    const lines: string[] = [];
    const io = {
      root,
      log: (line: string) => lines.push(line),
      writeFile: (file: string, content: string) => {
        written[file] = content;
      },
    };

    expect(await main(['--output', 'plan.json'], io)).toBe(0);
    expect(JSON.parse(written['plan.json'])).toEqual([{ tag: 'src-actions-common-a-v1.2.0', sha: released }]);
    expect(lines.at(-1)).toBe('2 package(s): 0 present, 1 to create, 1 unresolved.');
    expect(lines.some((line) => line.startsWith('::warning title=Unresolved source tag::src-actions-common-b'))).toBe(
      true,
    );

    expect(await main(['--strict'], io)).toBe(1);
  });

  it('fails on a malformed config', async () => {
    fs.writeFileSync(path.join(root, 'release-please-config.json'), '{"packages": []}');
    fs.writeFileSync(path.join(root, '.release-please-manifest.json'), '{}');

    expect(await main([], { root, log: () => undefined, writeFile: () => undefined })).toBe(1);
  });
});
