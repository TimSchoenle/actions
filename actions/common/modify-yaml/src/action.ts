import * as core from '@actions/core';

import { getInput, setOutput } from './generated/action-io.js';
import { modifyYaml } from './modify.js';

/**
 * Reads the action inputs, applies the change to the YAML file and publishes the outputs.
 *
 * `old-value` is only published when the key existed: an absent key and a key that was previously
 * empty are different situations, and collapsing them would leave a caller unable to tell whether it
 * added the key or overwrote it.
 */
export async function run(): Promise<void> {
  try {
    const file = getInput('file', { required: true });
    const key = getInput('key', { required: true });
    const value = getInput('value', { required: true });

    core.info(`Modifying ${key} in ${file}...`);

    const oldValue = await modifyYaml(file, key, value);

    if (oldValue !== undefined) {
      setOutput('old-value', oldValue);
    }
    setOutput('new-value', value);

    core.info(`✅ Modified ${key} to: ${value}`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}
