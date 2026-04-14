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

export async function getTagCommitSha(tag: string): Promise<string | null> {
  const trimmedTag = tag.trim();
  if (!trimmedTag) {
    return null;
  }

  const cached = TAG_SHA_CACHE.get(trimmedTag);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const sha = (await Sys.exec(`git rev-parse --verify --quiet ${trimmedTag}^{commit}`)).trim();
    if (!/^[\da-f]{40}$/i.test(sha)) {
      TAG_SHA_CACHE.set(trimmedTag, null);
      return null;
    }

    TAG_SHA_CACHE.set(trimmedTag, sha);
    return sha;
  } catch {
    TAG_SHA_CACHE.set(trimmedTag, null);
    return null;
  }
}
