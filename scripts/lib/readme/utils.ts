import path from 'node:path';

import { ROOT_DIR, Sys } from '../utils.js';

const MANIFEST_PATH = path.join(ROOT_DIR, '.release-please-manifest.json');
const RELEASE_PLEASE_CONFIG = path.join(ROOT_DIR, 'release-please-config.json');
const TAG_SHA_CACHE = new Map<string, string | null>();

export async function getManifestVersions(): Promise<Record<string, string>> {
  const file = Sys.file(MANIFEST_PATH);
  if (await file.exists()) {
    try {
      return await file.json();
    } catch (e) {
      console.warn('⚠️ Failed to parse .release-please-manifest.json:', e);
    }
  }
  return {};
}

export async function getReleaseComponent(dir: string): Promise<string | null> {
  const file = Sys.file(RELEASE_PLEASE_CONFIG);
  if (await file.exists()) {
    try {
      const config = await file.json();
      const normalizedDir = dir.replaceAll('\\', '/');
      if (config.packages?.[normalizedDir]) {
        return config.packages[normalizedDir].component;
      }
    } catch (e) {
      console.warn('⚠️ Failed to read release-please-config:', e);
    }
  }
  return null;
}

/** A tag name this module will look up: no whitespace, no revision syntax, no option-like start. */
const LOOKUP_TAG = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const FULL_SHA = /^[\da-f]{40}$/i;

/** The commit `tag` points at in the local repository, or null when it is not there. */
async function localTagCommit(tag: string): Promise<string | null> {
  try {
    const sha = (await Sys.exec(`git rev-parse --verify --quiet refs/tags/${tag}^{commit}`)).trim();
    return FULL_SHA.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * The commit `tag` points at on `origin`, or null. `ls-remote` lists a lightweight tag as its commit
 * and an annotated one twice, the second time peeled with `^{}`; the peeled line wins.
 */
async function remoteTagCommit(tag: string): Promise<string | null> {
  try {
    const output = await Sys.exec(`git ls-remote --tags origin refs/tags/${tag} refs/tags/${tag}^{}`);
    const refs = new Map(
      output
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((fields) => fields.length === 2 && FULL_SHA.test(fields[0]))
        .map(([sha, ref]) => [ref, sha] as const),
    );
    return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null;
  } catch {
    return null;
  }
}

/**
 * The commit a release tag points at, for pinning examples to it.
 *
 * Consumer tags point at build commits on the `releases` branch, which a checkout of `main` only has
 * when it fetched tags. The local repository is asked first, since a tag is never moved; `origin` is
 * asked when the tag is not there. Null when neither has it, and the caller pins the tag name.
 */
export async function getTagCommitSha(tag: string): Promise<string | null> {
  const trimmedTag = tag.trim();
  if (!LOOKUP_TAG.test(trimmedTag)) {
    return null;
  }

  const cached = TAG_SHA_CACHE.get(trimmedTag);
  if (cached !== undefined) {
    return cached;
  }

  const sha = (await localTagCommit(trimmedTag)) ?? (await remoteTagCommit(trimmedTag));
  TAG_SHA_CACHE.set(trimmedTag, sha);
  return sha;
}
