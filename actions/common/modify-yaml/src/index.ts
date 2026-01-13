import * as core from '@actions/core';

import { modifyYaml } from './modify.js';

export async function run() {
  try {
    const file = core.getInput('file', { required: true });
    const key = core.getInput('key', { required: true });
    const value = core.getInput('value', { required: true });

    core.info(`Modifying ${key} in ${file}...`);

    const oldValue = await modifyYaml(file, key, value);

    if (oldValue !== undefined) {
      core.setOutput('old-value', oldValue);
    }
    core.setOutput('new-value', value);

    core.info(`✅ Modified ${key} to: ${value}`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('Unknown error occurred');
    }
  }
}

// ESM Top-level await for the entry point
await run();
