import { assertE2eConfigured } from './packages/e2e/src/scratch-repo.js';

/**
 * Refuses to start an end-to-end run that cannot reach the scratch repository.
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
    assertE2eConfigured();
  }
}
