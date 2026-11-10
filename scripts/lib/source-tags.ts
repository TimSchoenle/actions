import { execFile } from 'node:child_process';

import { consumerTag, type ReleaseFiles, SOURCE_TAG_PREFIX, sourceTag } from './release-tags.js';

// Plans the source tags release-please needs: one `src-<component>-v<version>` per package, on the
// default-branch commit its manifest version was released from.
//
// release-please reads only `src-` tags (see SOURCE_TAG_PREFIX). release/publish-build-commit creates
// the source tag of every release it publishes, so this plan only has work to do for releases that
// never went through it:
//
// - a package released before the cutover, whose consumer tag points at a default-branch commit. The
//   source tag goes on that same commit.
// - a package that was added and never released. release-please needs a tag for the version in the
//   manifest, so the source tag goes on the parent of the commit that added the package: the commit
//   that added it, and every later one, then count as unreleased, exactly as they did when the
//   package had no tag at all.
//
// Anything else is reported as unresolved rather than guessed. A source tag cannot be moved once
// created, and one in the wrong place shifts every later changelog of its package.

/** The read-only git queries the plan needs, all against the checkout's HEAD. */
export interface SourceTagGit {
  /** The commit a tag points at, peeled through annotated tags; undefined when the tag does not exist. */
  tagCommit(tag: string): Promise<string | undefined>;
  /** Whether any tag starts with `prefix`. */
  hasTagStartingWith(prefix: string): Promise<boolean>;
  /** Whether `commit` is HEAD or one of its ancestors. */
  isAncestorOfHead(commit: string): Promise<boolean>;
  /** The oldest commit in HEAD's history whose change to `file` adds or removes `needle`. */
  firstCommitChanging(file: string, needle: string): Promise<string | undefined>;
  /** The first parent of `commit`; undefined for a root commit. */
  parentOf(commit: string): Promise<string | undefined>;
  /** The content of `file` at `commit`; undefined when it does not exist there. */
  fileAt(commit: string, file: string): Promise<string | undefined>;
}

export type SourceTagDecision =
  /** The source tag exists on a commit release-please reaches. */
  | { readonly kind: 'present'; readonly path: string; readonly tag: string; readonly sha: string }
  /** The source tag is missing and can be created on `sha`. */
  | {
      readonly kind: 'create';
      readonly path: string;
      readonly tag: string;
      readonly sha: string;
      readonly reason: 'released' | 'unreleased';
    }
  /** The source tag is missing, or misplaced, and nothing here can safely fix it. */
  | { readonly kind: 'unresolved'; readonly path: string; readonly tag: string; readonly reason: string };

/** The release-please manifest, relative to the repository root. */
export const MANIFEST_FILE = '.release-please-manifest.json';

const FULL_SHA = /^[0-9a-f]{40}$/;

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not a JSON object.`);
  }

  return value as Record<string, unknown>;
}

/** Every package with its component and manifest version, in config order. */
export function packageVersions(files: ReleaseFiles): { path: string; component: string; version: string }[] {
  const packages = asRecord(asRecord(files.config, 'release-please-config.json').packages, 'Its packages');
  const versions = asRecord(files.manifest, MANIFEST_FILE);

  return Object.entries(packages).map(([packagePath, raw]) => {
    const entry = asRecord(raw, `The ${packagePath} package`);
    const version = versions[packagePath];
    if (typeof entry.component !== 'string' || entry.component === '') {
      throw new Error(`${packagePath} has no component in release-please-config.json.`);
    }
    if (typeof version !== 'string' || version === '') {
      throw new Error(`${packagePath} has no version in ${MANIFEST_FILE}.`);
    }

    return { path: packagePath, component: entry.component, version };
  });
}

/** The version the manifest held for `packagePath` at `commit`, if it parses and has one. */
async function manifestVersionAt(git: SourceTagGit, commit: string, packagePath: string): Promise<string | undefined> {
  const text = await git.fileAt(commit, MANIFEST_FILE);
  if (text === undefined) {
    return undefined;
  }
  try {
    const value = asRecord(JSON.parse(text), MANIFEST_FILE)[packagePath];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Where a never-released package's source tag goes: the parent of the commit that added it. */
async function unreleasedBase(
  git: SourceTagGit,
  pkg: { path: string; version: string },
): Promise<string | { reason: string }> {
  const added = await git.firstCommitChanging(MANIFEST_FILE, JSON.stringify(pkg.path));
  if (added === undefined) {
    return { reason: `no commit in this history adds ${pkg.path} to ${MANIFEST_FILE}` };
  }
  const addedWith = await manifestVersionAt(git, added, pkg.path);
  if (addedWith !== pkg.version) {
    return {
      reason:
        `${pkg.path} was added at ${addedWith ?? 'no version'} in ${added} and is at ${pkg.version} now, ` +
        'but has no tag for it: a release of it is in flight or failed part-way. Finish that release ' +
        '(re-run its publish job) instead of tagging by hand',
    };
  }
  const parent = await git.parentOf(added);
  if (parent === undefined) {
    return { reason: `${added}, which added ${pkg.path}, is a root commit` };
  }

  return parent;
}

/** Decides one package's source tag. */
async function decide(
  git: SourceTagGit,
  pkg: { path: string; component: string; version: string },
): Promise<SourceTagDecision> {
  const source = sourceTag(pkg.component, pkg.version);
  const consumer = consumerTag(pkg.component, pkg.version);
  const unresolved = (reason: string): SourceTagDecision => ({
    kind: 'unresolved',
    path: pkg.path,
    tag: source,
    reason,
  });

  const existing = await git.tagCommit(source);
  if (existing !== undefined) {
    return (await git.isAncestorOfHead(existing))
      ? { kind: 'present', path: pkg.path, tag: source, sha: existing }
      : unresolved(`${source} points at ${existing}, which is not in the default branch's history`);
  }

  const released = await git.tagCommit(consumer);
  if (released !== undefined) {
    return (await git.isAncestorOfHead(released))
      ? { kind: 'create', path: pkg.path, tag: source, sha: released, reason: 'released' }
      : unresolved(
          `${consumer} points at ${released}, a build commit, but its source tag is missing. ` +
            'Re-run the publish job of that release, which creates both',
        );
  }

  // A package with any tag of its own has been released, so a missing tag for its current version
  // means a release is under way. Only a package with none at all can be one that never was.
  const consumerPrefix = consumerTag(pkg.component, '');
  if (
    (await git.hasTagStartingWith(consumerPrefix)) ||
    (await git.hasTagStartingWith(`${SOURCE_TAG_PREFIX}${consumerPrefix}`))
  ) {
    return unresolved(
      `neither ${consumer} nor ${source} exists, though ${pkg.path} has earlier releases: a release is in flight ` +
        'or failed part-way. Finish it (re-run its publish job) instead of tagging by hand',
    );
  }

  const base = await unreleasedBase(git, pkg);
  if (typeof base !== 'string') {
    return unresolved(base.reason);
  }

  return { kind: 'create', path: pkg.path, tag: source, sha: base, reason: 'unreleased' };
}

/**
 * Decides the source tag of every package, in config order.
 *
 * @throws an `Error` when the config or manifest is malformed, or a git query returns something that
 * is not a full commit id
 */
export async function planSourceTags(files: ReleaseFiles, git: SourceTagGit): Promise<SourceTagDecision[]> {
  const decisions: SourceTagDecision[] = [];
  for (const pkg of packageVersions(files)) {
    const decision = await decide(git, pkg);
    if (decision.kind !== 'unresolved' && !FULL_SHA.test(decision.sha)) {
      throw new Error(`git returned ${JSON.stringify(decision.sha)} for ${decision.tag}, not a full commit id.`);
    }
    decisions.push(decision);
  }

  return decisions;
}

/** The tags to create, as the source-tags job of release.yml reads them. */
export function tagsToCreate(decisions: readonly SourceTagDecision[]): { tag: string; sha: string }[] {
  return decisions.flatMap((decision) =>
    decision.kind === 'create' ? [{ tag: decision.tag, sha: decision.sha }] : [],
  );
}

/** Runs git in `cwd` and resolves to its exit code and stdout. Never uses a shell. */
export type GitCapture = (args: readonly string[]) => Promise<{ exitCode: number; stdout: string }>;

export function gitCapture(cwd: string): GitCapture {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile('git', [...args], { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout });
          return;
        }
        if (typeof error.code === 'number') {
          resolve({ exitCode: error.code, stdout });
          return;
        }
        reject(error);
      });
    });
}

/** A {@link SourceTagGit} over a checkout. Needs the full history and every tag fetched. */
export function checkoutSourceTagGit(git: GitCapture): SourceTagGit {
  const required = async (args: readonly string[]): Promise<string> => {
    const result = await git(args);
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} failed with exit code ${result.exitCode}.`);
    }
    return result.stdout;
  };

  return {
    async tagCommit(tag) {
      // `rev-parse --verify --quiet` exits 1 for a ref that does not exist; anything else is an error.
      const result = await git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`]);
      if (result.exitCode === 1) {
        return undefined;
      }
      if (result.exitCode !== 0) {
        throw new Error(`git rev-parse failed for tag ${tag} with exit code ${result.exitCode}.`);
      }
      return result.stdout.trim();
    },
    async hasTagStartingWith(prefix) {
      // `git tag --list` takes a glob; a prefix of letters, digits, '.', '-' and '_' carries no glob
      // character, which this checks rather than trusts.
      if (!/^[A-Za-z0-9._-]+$/.test(prefix)) {
        throw new Error(`Refusing to list tags by the prefix ${JSON.stringify(prefix)}.`);
      }
      return (await required(['tag', '--list', `${prefix}*`])).trim() !== '';
    },
    async isAncestorOfHead(commit) {
      const result = await git(['merge-base', '--is-ancestor', commit, 'HEAD']);
      if (result.exitCode === 0 || result.exitCode === 1) {
        return result.exitCode === 0;
      }
      throw new Error(`git merge-base failed for ${commit} with exit code ${result.exitCode}.`);
    },
    async firstCommitChanging(file, needle) {
      const out = await required(['log', '--reverse', '--format=%H', '-S', needle, 'HEAD', '--', file]);
      return out.split('\n').find((line) => line !== '');
    },
    async parentOf(commit) {
      const result = await git(['rev-parse', '--verify', '--quiet', `${commit}^1`]);
      return result.exitCode === 0 ? result.stdout.trim() : undefined;
    },
    async fileAt(commit, file) {
      const result = await git(['show', `${commit}:${file}`]);
      return result.exitCode === 0 ? result.stdout : undefined;
    },
  };
}
