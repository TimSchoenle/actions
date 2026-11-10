/**
 * The utilities every action may import.
 *
 * Deliberately free of Octokit (`actions-util/octokit`): importing it has side effects the bundler cannot shake
 * out, so re-exporting it here would ship an HTTP client inside actions that never make a request —
 * it doubled the `read-yaml` bundle when it was tried. The GitHub REST adapters therefore live behind
 * the `actions-util/branches` entry point, which only the actions that talk to GitHub import.
 *
 * The same holds for the `yaml` package, which cannot be shaken either and lives behind
 * `actions-util/yaml`. The runner interface has its own entry point, `actions-util/core`, so actions
 * import it as a namespace (`core.info`) and tests can mock it as one module.
 */
export * from './action.js';
export * from './action-io.js';
export * from './branch-verification.js';
export * from './commit-verification.js';
export * from './errors.js';
export * from './github.js';
export * from './http-request.js';
export * from './identity.js';
export * from './log.js';
export * from './posix-regex.js';
export * from './pull-request-url.js';
export * from './workspace-path.js';
