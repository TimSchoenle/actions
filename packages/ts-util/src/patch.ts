/**
 * Git plumbing and the patch-artifact contract, for the actions that compute, move or apply a diff.
 *
 * A separate entry point, `actions-util/patch`, rather than part of `index.ts`: every action bundles
 * the root entry, and growing it renumbers the modules the minifier sees, so each unrelated bundle
 * would change bytes — and need a release — for code it never calls.
 */
export * from './pathspec.js';
