import * as core from '@actions/core';
import { quoteForLog, runAction } from 'actions-util';

import { getInput, setOutput } from './generated/action-io.js';
import { readYaml } from './read.js';

/**
 * Reads the action inputs, resolves the key in the YAML file and publishes the value.
 *
 * The value is published through `core.setOutput`, which encodes multi-line values with a delimiter.
 * The bash predecessor appended `value=$VALUE` to `$GITHUB_OUTPUT` directly and corrupted the file
 * whenever the value spanned more than one line, so maps and sequences are only now readable.
 */
export function run(): Promise<void> {
  return runAction(async () => {
    const file = getInput('file', { required: true });
    const key = getInput('key', { required: true });

    core.info(`Reading ${quoteForLog(key)} from ${quoteForLog(file)}...`);

    const value = await readYaml(file, key);

    setOutput('value', value);

    // Quoted, not interpolated: the file is repository content, and a value spanning lines would
    // otherwise put whatever it likes at the start of a stdout line, where the runner reads commands.
    core.info(`✅ Read value: ${quoteForLog(value)}`);
  });
}
