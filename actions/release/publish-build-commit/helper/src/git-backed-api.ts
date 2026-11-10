/**
 * A {@link PublishApi} backed by a real git repository on disk, for the unit tests.
 *
 * Objects, refs and fast-forward checks come from git itself, so the tree ids `planTree` computes are
 * checked against git's, not against a second implementation of the same encoding. Releases, labels
 * and comments are kept in memory.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CompareStatus, GitTreeItem, PublishApi, Release, ReleaseAsset } from './github.js';

/** A release as the fake stores it, with asset contents. */
export interface StoredRelease extends Omit<Release, 'draft' | 'assets'> {
  draft: boolean;
  assets: ReleaseAsset[];
  name: string;
  body: string;
  makeLatest: string | undefined;
  assetContents: Map<string, Buffer>;
}

export class GitBackedApi implements PublishApi {
  readonly releases: StoredRelease[] = [];
  readonly labels = new Map<number, Set<string>>();
  readonly comments = new Map<number, string[]>();
  /** Every write, in order, for assertions on what a run did. */
  readonly writes: string[] = [];
  /** Called before a ref update, so a test can move the branch underneath the publisher. */
  beforeUpdateRef: ((ref: string) => void) | undefined;
  private nextId = 1;

  private constructor(readonly directory: string) {}

  static create(): GitBackedApi {
    const directory = fs.mkdtempSync(path.join(tmpdir(), 'publish-git-'));
    const api = new GitBackedApi(directory);
    api.git(['init', '--quiet', '--bare']);

    return api;
  }

  dispose(): void {
    fs.rmSync(this.directory, { recursive: true, force: true });
  }

  git(args: string[], input?: string | Buffer, env: NodeJS.ProcessEnv = {}): string {
    return execFileSync('git', args, {
      cwd: this.directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        ...env,
      },
      input,
    }).trim();
  }

  /** Commits `files` (path to content) as a root commit, or on `parent`, and returns its id. */
  commitFiles(files: Record<string, string>, parent?: string): string {
    const index = path.join(this.directory, `index-${this.nextId++}`);
    for (const [file, content] of Object.entries(files)) {
      const blob = this.git(['hash-object', '-w', '--stdin'], content);
      this.git(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], undefined, {
        GIT_INDEX_FILE: index,
      });
    }
    const tree = this.git(['write-tree'], undefined, { GIT_INDEX_FILE: index });

    return this.git(['commit-tree', tree, '-m', 'fixture', ...(parent === undefined ? [] : ['-p', parent])]);
  }

  /** The content of `file` in the tree of `commit`. */
  show(commit: string, file: string): string {
    return this.git(['show', `${commit}:${file}`]);
  }

  async getCommit(sha: string) {
    const lines = this.git(['cat-file', 'commit', sha]).split('\n');

    return {
      sha,
      tree: (lines.find((line) => line.startsWith('tree ')) ?? '').slice(5),
      parents: lines.filter((line) => line.startsWith('parent ')).map((line) => line.slice(7)),
    };
  }

  async getTree(sha: string): Promise<GitTreeItem[]> {
    const output = this.git(['ls-tree', sha]);

    return output === ''
      ? []
      : output.split('\n').map((line) => {
          const [meta, name] = line.split('\t');
          const [mode, type, objectSha] = meta.split(' ');

          return { name, mode, type: type as GitTreeItem['type'], sha: objectSha };
        });
  }

  async resolveRef(ref: string): Promise<string | undefined> {
    try {
      return this.git(['rev-parse', '--verify', '--quiet', `refs/${ref}^{commit}`]);
    } catch {
      return undefined;
    }
  }

  async createBlob(content: Uint8Array): Promise<string> {
    this.writes.push('blob');

    return this.git(['hash-object', '-w', '--stdin'], Buffer.from(content));
  }

  async createTree(baseTree: string, files: ReadonlyArray<{ path: string; sha: string }>): Promise<string> {
    this.writes.push('tree');
    const index = path.join(this.directory, `index-${this.nextId++}`);
    const env = { GIT_INDEX_FILE: index };
    this.git(['read-tree', baseTree], undefined, env);
    for (const file of files) {
      this.git(['update-index', '--add', '--cacheinfo', `100644,${file.sha},${file.path}`], undefined, env);
    }

    return this.git(['write-tree'], undefined, env);
  }

  async createCommit(message: string, tree: string, parents: readonly string[]): Promise<string> {
    this.writes.push('commit');

    return this.git(['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent])], message);
  }

  async createRef(ref: string, sha: string): Promise<'created' | 'exists'> {
    if ((await this.resolveRef(ref)) !== undefined) {
      return 'exists';
    }
    this.writes.push(`ref:${ref}`);
    this.git(['update-ref', `refs/${ref}`, sha, '']);

    return 'created';
  }

  async updateRef(ref: string, sha: string): Promise<'updated' | 'not-fast-forward'> {
    this.beforeUpdateRef?.(ref);
    const current = await this.resolveRef(ref);
    if (current === undefined) {
      throw new Error(`refs/${ref} does not exist`);
    }
    if ((await this.compare(current, sha)) !== 'ahead') {
      return 'not-fast-forward';
    }
    this.writes.push(`ref:${ref}`);
    this.git(['update-ref', `refs/${ref}`, sha, current]);

    return 'updated';
  }

  async compare(base: string, head: string): Promise<CompareStatus> {
    if (base === head) {
      return 'identical';
    }
    let mergeBase: string;
    try {
      mergeBase = this.git(['merge-base', base, head]);
    } catch {
      // Unrelated histories have no merge base.
      return 'diverged';
    }
    if (mergeBase === base) {
      return 'ahead';
    }

    return mergeBase === head ? 'behind' : 'diverged';
  }

  async listReleases(): Promise<Release[]> {
    return this.releases.map((release) => ({ ...release, assets: [...release.assets] }));
  }

  async createDraftRelease(tagName: string, name: string, body: string): Promise<Release> {
    this.writes.push(`release:${tagName}`);
    const id = this.nextId++;
    const release: StoredRelease = {
      id,
      tagName,
      draft: true,
      htmlUrl: `https://github.com/o/r/releases/${id}`,
      uploadUrl: `https://uploads.github.com/repos/o/r/releases/${id}/assets{?name,label}`,
      assets: [],
      name,
      body,
      makeLatest: undefined,
      assetContents: new Map(),
    };
    this.releases.push(release);

    return { ...release };
  }

  private stored(id: number): StoredRelease {
    const release = this.releases.find((candidate) => candidate.id === id);
    if (release === undefined) {
      throw new Error(`no release ${id}`);
    }

    return release;
  }

  async publishRelease(id: number, name: string, body: string, makeLatest: string): Promise<Release> {
    this.writes.push(`publish:${id}`);
    const release = this.stored(id);
    Object.assign(release, { draft: false, name, body, makeLatest });

    return { ...release };
  }

  async uploadAsset(release: Release, name: string, content: Uint8Array): Promise<ReleaseAsset> {
    this.writes.push(`asset:${name}`);
    const stored = this.stored(release.id);
    if (!stored.draft) {
      throw new Error('assets of a published release are immutable');
    }
    const asset = { id: this.nextId++, name };
    stored.assets = [...stored.assets, asset];
    stored.assetContents.set(name, Buffer.from(content));

    return asset;
  }

  async deleteAsset(id: number): Promise<void> {
    this.writes.push(`delete-asset:${id}`);
    for (const release of this.releases) {
      const asset = release.assets.find((candidate) => candidate.id === id);
      if (asset !== undefined) {
        release.assets = release.assets.filter((candidate) => candidate.id !== id);
        release.assetContents.delete(asset.name);
      }
    }
  }

  async issueLabels(issue: number): Promise<string[]> {
    return [...(this.labels.get(issue) ?? [])];
  }

  async addLabel(issue: number, label: string): Promise<void> {
    this.writes.push(`label+${label}`);
    this.labels.set(issue, new Set([...(this.labels.get(issue) ?? []), label]));
  }

  async removeLabel(issue: number, label: string): Promise<void> {
    this.writes.push(`label-${label}`);
    this.labels.get(issue)?.delete(label);
  }

  async issueCommentBodies(issue: number): Promise<string[]> {
    return [...(this.comments.get(issue) ?? [])];
  }

  async createComment(issue: number, body: string): Promise<void> {
    this.writes.push('comment');
    this.comments.set(issue, [...(this.comments.get(issue) ?? []), body]);
  }
}
