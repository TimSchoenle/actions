import { quoteForLog, resolveRealWithinWorkspace, runAction, workspaceRoot } from 'actions-util';
import * as core from 'actions-util/core';

import { getInput, setOutput } from './generated/action-io.js';
import { modifyYaml } from './modify.js';

/**
 * Reads the action inputs, applies the change to the YAML file and publishes the outputs.
 *
 * `old-value` is only published when the key existed: an absent key and a key that was previously
 * empty are different situations, and collapsing them would leave a caller unable to tell whether it
 * added the key or overwrote it.
 *
 * `file` must resolve inside the workspace, links included. The action reads the file into an output
 * and writes it back, so a committed link or a `..` path would otherwise leak and overwrite any file
 * the runner can reach.
 */
export function run(): Promise<void> {
  return runAction(async () => {
    const file = getInput('file', { required: true });
    const key = getInput('key', { required: true });
    const value = getInput('value', { required: true });

    const filePath = await resolveRealWithinWorkspace(file, workspaceRoot(), 'file');

    core.info(`Modifying ${quoteForLog(key)} in ${quoteForLog(file)}...`);

    const oldValue = await modifyYaml(filePath, key, value);

    if (oldValue !== undefined) {
      setOutput('old-value', oldValue);
    }
    setOutput('new-value', value);

    core.info(`✅ Modified ${quoteForLog(key)} to: ${quoteForLog(value)}`);
  });
}
