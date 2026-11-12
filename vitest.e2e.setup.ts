import { fileURLToPath } from 'node:url';

import { rebuildStaleBundles } from './packages/e2e/src/autobuild.js';
import { assertE2eConfigured } from './packages/e2e/src/scratch-repo.js';

/** Set to `1` by the generated job of a suite that holds no token (no `token-permissions`). */
const TOKENLESS_ENV = 'E2E_TOKENLESS';

/** Set to `1` to run on whatever bundles are on disk, without rebuilding stale ones first. */
const NO_AUTOBUILD_ENV = 'E2E_NO_AUTOBUILD';

/**
 * Refuses to start an end-to-end run that cannot reach the scratch repository, and locally rebuilds
 * stale bundles first.
 *
 * Checked once, before any file loads, rather than guarded per case: a suite that skips itself when
 * a credential is missing reports green, and a green report for tests that never ran is the exact
 * failure this suite exists to prevent.
 */
export function setup(): void {
  // Locally this stays quiet, so the cases that need no credentials at all — `read-yaml` and
  // `modify-yaml` only touch the filesystem — can be run without minting a token. In CI a missing
  // token is a configuration failure and must stop the run before a single file loads; the suites
  // that do reach GitHub would otherwise be the only thing reporting it, one error at a time.
  if (process.env['CI'] !== undefined) {
    // A suite whose job holds no token says so, and only ScratchRepo, which every case that reaches
    // GitHub goes through, insists on credentials. A case that starts reaching GitHub without its
    // source asking for a token therefore still fails, at its first ScratchRepo, instead of passing.
    if (process.env[TOKENLESS_ENV] !== '1') {
      assertE2eConfigured();
    }
    // CI never builds here: the cases run the bundles the verify workflow built and installed.
    return;
  }

  // Locally the cases run the bundles on disk, so a bundle older than its sources is rebuilt first,
  // with the same build CI runs. Only stale ones: a run after an edit pays for that edit alone.
  if (process.env[NO_AUTOBUILD_ENV] !== '1') {
    rebuildStaleBundles(fileURLToPath(new URL('.', import.meta.url)));
  }
}
