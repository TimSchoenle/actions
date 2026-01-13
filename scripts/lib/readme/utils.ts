import path from 'node:path';

import { ROOT_DIR, Sys } from '../utils.js';

const MANIFEST_PATH = path.join(ROOT_DIR, '.release-please-manifest.json');
const RELEASE_PLEASE_CONFIG = path.join(ROOT_DIR, 'release-please-config.json');

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
