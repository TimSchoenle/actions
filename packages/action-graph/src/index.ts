/**
 * The dependency graph of the GitHub Actions in a repository, and the manifest that carries built
 * bundles between jobs.
 *
 * One implementation serves the repository scripts (the workflow generator, the local build), the
 * release actions that build, install and publish bundles, and the end-to-end harness, so all of them
 * agree on what an action needs. Every path in and out is repository-relative (see `paths.ts`).
 *
 * Node.js built-ins and `yaml` only: the module is bundled into actions.
 *
 * @packageDocumentation
 */
export * from './artifact-record.js';
export * from './build-set.js';
export * from './bundle-manifest.js';
export * from './discover.js';
export * from './hash.js';
export * from './local-refs.js';
export * from './manifest.js';
export * from './path-list.js';
export * from './paths.js';
export * from './source-inputs.js';
