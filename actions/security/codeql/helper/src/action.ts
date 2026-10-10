import * as core from '@actions/core';
import { quoteForLog, runAction } from 'actions-util';

import { buildConfig, excludedPaths, renderConfig } from './config.js';
import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { resolveOptions } from './options.js';

import type { RawInputs } from './options.js';

/**
 * The bundle the `security/codeql` composite runs before `codeql-action/init`.
 *
 * It validates every input and resolves the configuration and the category, so the CodeQL steps
 * that follow receive only values already known to be usable. Nothing here reaches the network or
 * the workspace.
 */

function readInputs(): RawInputs {
  return {
    language: getInput(ActionInput.language),
    excludeTestPaths: getInput(ActionInput.exclude_test_paths),
    pathsIgnore: getInput(ActionInput.paths_ignore),
    category: getInput(ActionInput.category),
    upload: getInput(ActionInput.upload),
  };
}

/** Resolves the configuration and publishes it as outputs for the CodeQL steps. */
export function run(): void {
  runAction(() => {
    const options = resolveOptions(readInputs());
    const paths = excludedPaths(options);

    if (paths.length === 0) {
      core.info(`Analysing ${options.language} with no path excluded.`);
    } else {
      core.info(`Analysing ${options.language} with ${paths.length} path pattern(s) excluded:`);

      for (const pattern of paths) {
        core.info(`  ${quoteForLog(pattern)}`);
      }
    }

    setOutput(ActionOutput.language, options.language);
    setOutput(ActionOutput.config, renderConfig(buildConfig(options)));
    setOutput(ActionOutput.category, options.category);
    setOutput(ActionOutput.upload, options.upload ? 'always' : 'never');
  });
}
