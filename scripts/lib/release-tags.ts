import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ROOT_DIR } from './utils.js';

// Works out which consumer tags a release published and waits until git can see all of them.
//
// release/publish-build-commit creates each tag through the REST API and succeeds only once every call
// has, so the tags exist by the time a later job starts. A `git fetch` can still trail the API for a
// moment, and the docs generator pins each README to the commit its tag resolves
// to, so a tag that is not visible yet would leave that README pinned to the tag name. The wait here
// turns that gap into a short retry, and into a failure naming the tags if it does not close.

/** Pauses before each re-fetch, in milliseconds. Four retries, about 75 seconds in all. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000];

export interface ReleaseFiles {
  /** Parsed `release-please-config.json`. */
  config: unknown;
  /** Parsed `.release-please-manifest.json`. */
  manifest: unknown;
}

export interface TagRepository {
  /** Fetches every tag from the remote, replacing local ones that moved. */
  fetchTags(): Promise<void>;
  /** Whether the local repository has the tag. */
  hasTag(tag: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not a JSON object.`);
  }

  return value as Record<string, unknown>;
}

/**
 * Prefix of every release-please component, and so of every tag release-please reads.
 *
 * release-please finds a package's previous release by its tag and then walks the default branch back
 * to that tag's commit. The tags consumers pin point at build commits on the `releases` branch, which
 * the walk never reaches, so release-please gets tags of its own on the default branch: the consumer
 * tag with this prefix. Components without it are configured for no package, so release-please ignores
 * the consumer tags as belonging to an unknown component.
 */
export const SOURCE_TAG_PREFIX = 'src-';

/** A component as consumers see it: the release-please component without {@link SOURCE_TAG_PREFIX}. */
export function consumerComponent(component: string): string {
  return component.startsWith(SOURCE_TAG_PREFIX) ? component.slice(SOURCE_TAG_PREFIX.length) : component;
}

/** The tag consumers pin for a release: `<consumer component>-v<version>`, on the build commit. */
export function consumerTag(component: string, version: string): string {
  return `${consumerComponent(component)}-v${version}`;
}

/** The tag release-please reads for a release: `src-<consumer component>-v<version>`, on the source commit. */
export function sourceTag(component: string, version: string): string {
  return `${SOURCE_TAG_PREFIX}${consumerTag(component, version)}`;
}

/** The release-please component of the package at `packagePath`: `src-` plus the path with `/` as `-`. */
export function sourceComponentFor(packagePath: string): string {
  return `${SOURCE_TAG_PREFIX}${packagePath.replaceAll('/', '-')}`;
}

/**
 * Parses release-please's `paths_released` output, a JSON array of package paths.
 */
export function parseReleasedPaths(raw: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`paths_released is not JSON: ${raw}`);
  }

  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error(`paths_released is not an array of paths: ${raw}`);
  }

  return parsed;
}

/**
 * The consumer tag of each released path: `<component>-v<version>` with the source prefix removed
 * from the component (`include-component-in-tag`, true by default). These are the tags
 * release/publish-build-commit creates on the build commit, and the ones every README pins.
 *
 * A path missing from the config or the manifest throws instead of being skipped: the commit being
 * released is the one these files were read from, so a gap means the inputs are wrong, and waiting
 * for a guessed tag would hide that.
 */
export function expectedReleaseTags(files: ReleaseFiles, releasedPaths: readonly string[]): string[] {
  const packages = asRecord(asRecord(files.config, 'release-please-config.json').packages, 'Its packages');
  const versions = asRecord(files.manifest, '.release-please-manifest.json');

  return releasedPaths.map((releasedPath) => {
    if (!Object.hasOwn(packages, releasedPath)) {
      throw new Error(`${releasedPath} was released but is not a package in release-please-config.json.`);
    }

    const entry = asRecord(packages[releasedPath], `The ${releasedPath} package`);
    const version = Object.hasOwn(versions, releasedPath) ? versions[releasedPath] : undefined;

    if (typeof entry.component !== 'string' || entry.component === '') {
      throw new Error(`${releasedPath} has no component in release-please-config.json.`);
    }

    // release-please defaults this to true for manifest packages, so only an explicit false changes
    // the tag name.
    if (entry['include-component-in-tag'] === false) {
      throw new Error(`${releasedPath} sets include-component-in-tag to false, which this repository does not use.`);
    }

    if (typeof version !== 'string' || version === '') {
      throw new Error(`${releasedPath} has no version in .release-please-manifest.json.`);
    }

    return consumerTag(entry.component, version);
  });
}

async function missingTags(repository: TagRepository, tags: readonly string[]): Promise<string[]> {
  const missing: string[] = [];

  for (const tag of tags) {
    if (!(await repository.hasTag(tag))) {
      missing.push(tag);
    }
  }

  return missing;
}

/**
 * Fetches tags until every one in `tags` is present, pausing for each entry of `retryDelaysMs` in
 * turn between attempts. Throws with the names of the tags still missing after the last attempt.
 */
export async function waitForTags(
  repository: TagRepository,
  tags: readonly string[],
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    await repository.fetchTags();
    const missing = await missingTags(repository, tags);

    if (missing.length === 0) {
      return;
    }

    if (attempt >= retryDelaysMs.length) {
      throw new Error(`Release tags still missing after ${attempt + 1} fetches: ${missing.join(', ')}.`);
    }

    await repository.sleep(retryDelaysMs[attempt]);
  }
}

/** Runs git in `cwd` with stderr passed through, and resolves to its exit code. */
export type GitRunner = (args: string[]) => Promise<number>;

export function gitRunner(cwd: string = ROOT_DIR): GitRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });
}

/** A {@link TagRepository} over a git checkout's `origin` remote. */
export function gitTagRepository(
  git: GitRunner,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): TagRepository {
  return {
    async fetchTags() {
      const exitCode = await git(['fetch', '--force', '--tags', '--quiet', 'origin']);

      if (exitCode !== 0) {
        throw new Error(`git fetch --tags failed with exit code ${exitCode}.`);
      }
    },
    // `rev-parse --verify --quiet` exits 1 for a ref that does not exist. Any other failure is a lookup
    // error, which retrying would only turn into a misleading "missing" report.
    async hasTag(tag) {
      const exitCode = await git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);

      if (exitCode !== 0 && exitCode !== 1) {
        throw new Error(`git rev-parse failed for tag ${tag} with exit code ${exitCode}.`);
      }

      return exitCode === 0;
    },
    sleep,
  };
}

export interface WaitReleaseTagsIo {
  /** JSON array of the released package paths. */
  releasedPaths: string | undefined;
  readFiles(): Promise<ReleaseFiles>;
  repository: TagRepository;
  log(message: string): void;
}

/** Reads the release-please config and manifest from a checkout. */
export async function readReleaseFiles(root: string = ROOT_DIR): Promise<ReleaseFiles> {
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await fs.readFile(path.join(root, file), 'utf8')) as unknown;

  return { config: await read('release-please-config.json'), manifest: await read('.release-please-manifest.json') };
}

/** Waits until every consumer tag the release published is visible to git. */
export async function waitReleaseTags(io: WaitReleaseTagsIo, retryDelaysMs?: readonly number[]): Promise<void> {
  if (!io.releasedPaths) {
    throw new Error('RELEASED_PATHS is required.');
  }

  const tags = expectedReleaseTags(await io.readFiles(), parseReleasedPaths(io.releasedPaths));

  io.log(`Waiting for ${tags.length} release tag(s): ${tags.join(', ')}`);
  await waitForTags(io.repository, tags, retryDelaysMs);
  io.log('Every release tag is present.');
}

export async function main(): Promise<void> {
  await waitReleaseTags({
    releasedPaths: process.env.RELEASED_PATHS,
    readFiles: () => readReleaseFiles(),
    repository: gitTagRepository(gitRunner()),
    log: (message) => console.log(message),
  });
}
