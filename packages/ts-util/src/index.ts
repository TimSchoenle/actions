/**
 * The utilities every action may import.
 *
 * Deliberately free of `@actions/github`: importing Octokit has side effects the bundler cannot shake
 * out, so re-exporting it here would ship an HTTP client inside actions that never make a request —
 * it doubled the `read-yaml` bundle when it was tried. The GitHub REST adapters therefore live behind
 * the `actions-util/branches` entry point, which only the actions that talk to GitHub import.
 */
export * from './action.js';
export * from './action-io.js';
export * from './branch-verification.js';
export * from './commit-verification.js';
export * from './errors.js';
export * from './github.js';
export * from './identity.js';
export * from './posix-regex.js';
export * from './yaml.js';
export * from './yaml-document.js';
