import fs from 'node:fs';
import path from 'node:path';

import { ROOT_DIR } from './utils.js';

/**
 * The pinned Renovate install the Renovate checks run.
 *
 * It lives in its own package under `.github/` rather than in the root workspace, so the jobs that
 * do not need Renovate do not install it, and the preset's `.github/**` rules commit its updates as
 * `ci(deps)`.
 */
export const RENOVATE_TOOL_DIR = path.join(ROOT_DIR, '.github', 'tools', 'renovate');

export const RENOVATE_INSTALL_COMMAND = 'bun install --frozen-lockfile --cwd .github/tools/renovate';

/** Entry points of the `renovate` package, as its `bin` field maps them. */
export type RenovateEntry = 'config-validator' | 'renovate';

/** Absolute path of a Renovate entry point. Throws with the install command when it is missing. */
export function renovateEntry(entry: RenovateEntry): string {
  const file = path.join(RENOVATE_TOOL_DIR, 'node_modules', 'renovate', 'dist', `${entry}.js`);

  if (!fs.existsSync(file)) {
    throw new Error(`Renovate is not installed at ${RENOVATE_TOOL_DIR}. Run '${RENOVATE_INSTALL_COMMAND}'.`);
  }

  return file;
}
