/**
 * The check that an end-to-end run executes the bundle the workflow built from the commit under test.
 *
 * The verify workflows build every bundle a suite needs in a build job and install them with
 * `release/install-built-actions`, which exports `BUILT_ACTIONS_MANIFEST`. The workflow's build set is
 * computed statically; a case that reaches a bundle in a way that analysis cannot see would otherwise
 * run whatever happens to be in the checkout. Checking each bundle against the manifest turns that
 * into a failure that names the fix.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBundleManifest, sha256Hex } from 'action-graph';

/** The variable `release/install-built-actions` exports. */
export const BUILT_ACTIONS_MANIFEST_ENV = 'BUILT_ACTIONS_MANIFEST';

/** The repository this harness belongs to; bundles outside it are not checked. */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Raised when the bundle a case is about to run is not the one the workflow built. */
export class BuiltBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuiltBundleError';
  }
}

/**
 * Checks `bundle` against the installed manifest before it runs.
 *
 * With `BUILT_ACTIONS_MANIFEST` set, the bundle must be listed and its SHA-256 must match. Without
 * it, a run in CI fails, since every verify workflow installs its bundles, while a local run passes:
 * `vitest.e2e.setup.ts` rebuilds stale bundles there instead. A bundle outside this repository, such
 * as a fixture in a temporary directory, is not checked.
 *
 * @param bundle - absolute path of the bundle about to run
 * @param env - the environment to read, `process.env` by default
 * @param root - the repository root
 * @throws {@link BuiltBundleError} when the bundle is unlisted, differs, or the manifest is missing in CI
 */
export function assertBuiltBundle(
  bundle: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  root: string = REPOSITORY_ROOT,
): void {
  const relative = path.relative(root, bundle).split(path.sep).join('/');
  // Outside the repository by path segment: a directory named `..foo` inside it is still checked.
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    return;
  }

  const manifestPath = env[BUILT_ACTIONS_MANIFEST_ENV];
  if (manifestPath === undefined || manifestPath === '') {
    if (env['CI'] !== undefined) {
      throw new BuiltBundleError(
        `${BUILT_ACTIONS_MANIFEST_ENV} is not set, so bundle ${relative} cannot be checked against this run's build. ` +
          'The verify workflow must install its bundles with release/install-built-actions; run `bun run generate-verify`.',
      );
    }
    return;
  }

  const manifest = parseBundleManifest(readFileSync(manifestPath, 'utf8'));
  const listed = manifest.files.find((file) => file.path === relative);
  if (listed === undefined) {
    throw new BuiltBundleError(
      `Bundle ${relative} is not in this run's build set; run \`bun run generate-verify\`. ` +
        'A case must reach another action through a literal new URL(..., import.meta.url) for the generator to see it.',
    );
  }
  const actual = sha256Hex(readFileSync(bundle));
  if (actual !== listed.sha256) {
    throw new BuiltBundleError(`Bundle ${relative} has SHA-256 ${actual}, but this run built ${listed.sha256}.`);
  }
}
