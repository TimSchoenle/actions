/**
 * Reads a `common/create-patch` artifact back from the directory download-artifact extracted it to,
 * for the actions that inspect or commit one.
 *
 * A separate entry point from `actions-util/patch` for the reason given there: create-patch never
 * reads an artifact, and adding this to the entry it bundles would change its bytes for nothing.
 */
export * from './patch-artifact-reader.js';
