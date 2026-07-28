import * as core from '@actions/core';
import { runAction } from 'actions-util';

import { generateFile } from './generate.js';
import { getBooleanInput, getInput, setOutput } from './generated/action-io.js';

/**
 * Reads the action inputs, renders the template and publishes what happened to the output file.
 *
 * The outputs are published in both modes and on the same terms, so a caller can branch on `changed`
 * without first branching on `check`. Under `check` a stale file fails the step, so `changed` is only
 * ever observed as `false` there — the useful signal is in write mode, where it gates the commit step
 * that would otherwise run on every scheduled build and produce an empty commit.
 */
export function run(): Promise<void> {
  return runAction(async () => {
    const templatePath = getInput('template', { required: true });
    const outputPath = getInput('output', { required: true });
    const check = getBooleanInput('check');

    core.info(`${check ? 'Checking' : 'Rendering'} ${outputPath} from ${templatePath}...`);

    const result = await generateFile({
      templatePath,
      outputPath,
      variables: getInput('variables'),
      partialsDir: getInput('partials-dir'),
      strict: getBooleanInput('strict'),
      escapeHtml: getBooleanInput('escape-html'),
      check,
    });

    setOutput('changed', String(result.changed));
    setOutput('checksum', result.checksum);
    setOutput('output-path', outputPath);

    if (result.partialCount > 0) {
      core.info(`Registered ${result.partialCount} partial(s).`);
    }

    if (check) {
      core.info(`✅ ${outputPath} is up to date.`);
      return;
    }

    core.info(result.changed ? `✅ Wrote ${outputPath}.` : `✅ ${outputPath} was already up to date; left untouched.`);
  });
}
