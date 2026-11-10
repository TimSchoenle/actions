import fs from 'node:fs';

import { parsePathList, toAbsolute, toRepoPath } from 'action-graph';
import { runAction } from 'actions-util';
import * as core from 'actions-util/core';

import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { RESOLVE_MODES, resolveActions } from './resolve.js';

import type { ResolveMode } from './resolve.js';

/** The workspace the runner checked out into: `GITHUB_WORKSPACE`, or the working directory outside a runner. */
function workspace(): string {
  return process.env['GITHUB_WORKSPACE'] || process.cwd();
}

function readMode(): ResolveMode {
  const mode = getInput(ActionInput.mode);
  if (!(RESOLVE_MODES as readonly string[]).includes(mode)) {
    throw new Error(`mode must be one of ${RESOLVE_MODES.join(', ')}; got ${JSON.stringify(mode)}.`);
  }

  return mode as ResolveMode;
}

/**
 * Resolves the build set of the requested actions and publishes it as JSON outputs.
 *
 * Reads the checkout only: no token, no network, and nothing in the checkout is executed.
 */
export function run(): void {
  runAction(() => {
    const root = toAbsolute(workspace(), toRepoPath(getInput(ActionInput.path) || '.', 'path'));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`path ${JSON.stringify(getInput(ActionInput.path))} is not a directory of the workspace.`);
    }

    const mode = readMode();
    const resolution = resolveActions({
      root,
      mode,
      targets: parsePathList(getInput(ActionInput.targets), 'target'),
      workflows: parsePathList(getInput(ActionInput.workflows), 'workflow'),
      checkoutPrefixes: parsePathList(getInput(ActionInput['checkout-prefixes']), 'checkout prefix'),
      exclude: parsePathList(getInput(ActionInput.exclude), 'excluded directory'),
      changedFiles: mode === 'affected' ? parsePathList(getInput(ActionInput['changed-files']), 'changed file') : [],
    });

    core.info(
      `Resolved ${resolution.actions.length} action(s), ${resolution.buildDirs.length} to build, ` +
        `${resolution.bundles.length} bundle(s).`,
    );
    setOutput(ActionOutput['build-dirs'], JSON.stringify(resolution.buildDirs));
    setOutput(ActionOutput.bundles, JSON.stringify(resolution.bundles));
    setOutput(ActionOutput.actions, JSON.stringify(resolution.actions));
    setOutput(ActionOutput['source-paths'], JSON.stringify(resolution.sourcePaths));
  });
}
