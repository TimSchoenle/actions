/**
 * Harness for driving a `node20` action end-to-end without a workflow.
 *
 * A node20 action is a bundle the runner executes with `INPUT_*` in the environment and a
 * `GITHUB_OUTPUT` file to write to. Reproducing that contract here buys three things a
 * workflow-per-case cannot: the cases run on a developer's machine, a whole action's suite fits in
 * one job instead of one job per case, and the assertions are typed TypeScript rather than shell.
 *
 * Composite actions are out of scope by construction — they can only be invoked by the runner — and
 * {@link parseActionManifest} refuses them with that reason rather than failing obscurely.
 */
export * from './action-inputs.js';
export * from './action-manifest.js';
export * from './github-file-commands.js';
export * from './run-action.js';
export * from './runtime.js';
export * from './scratch-repo.js';
export * from './workflow-commands.js';
