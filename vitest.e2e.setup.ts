import { assertE2eConfigured } from './packages/e2e/src/scratch-repo.js';

/**
 * Refuses to start an end-to-end run that cannot reach the scratch repository.
 *
 * Checked once, before any file loads, rather than guarded per case: a suite that skips itself when
 * a credential is missing reports green, and a green report for tests that never ran is the exact
 * failure this suite exists to prevent.
 */
export function setup(): void {
  assertE2eConfigured();
}
