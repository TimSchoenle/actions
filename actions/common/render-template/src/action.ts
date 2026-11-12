import { lstat } from 'node:fs/promises';

import { quoteForLog, resolveRealWithinWorkspace, runAction, UnsafePathError, workspaceRoot } from 'actions-util';
import * as core from 'actions-util/core';

import { generateFile } from './generate.js';
import { getBooleanInput, getInput, setOutput } from './generated/action-io.js';

/**
 * Rejects any path input that would reach outside the checkout.
 *
 * Validated, not rewritten: the action runs with the workspace as its working directory, so the
 * relative paths it is given already resolve inside it. The ways out are `..`, an absolute path and a
 * symbolic link committed to the repository, and all three are refused here — before a single file is
 * read or written, so a hostile `output` cannot leave a partial file somewhere the workflow never
 * looks, nor a linked `template` render the step's environment into one. Reporting the paths as the caller
 * wrote them is what keeps every downstream error message about `README.hbs` and not about
 * `/home/runner/work/repo/repo/README.hbs`.
 */
/**
 * Fails when the output is a symbolic link. Writing goes through a link, so even one that stays in the
 * workspace makes the render overwrite a file other than the one named; a missing output is fine.
 */
async function refuseLinkedOutput(resolved: string, outputPath: string): Promise<void> {
  const stats = await lstat(resolved).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  });

  if (stats?.isSymbolicLink() === true) {
    throw new UnsafePathError(
      `output is a symbolic link; refusing to write through it: ${quoteForLog(outputPath)}. Commit the file itself.`,
    );
  }
}

async function assertPathsWithinWorkspace(
  templatePath: string,
  outputPath: string,
  partialsDir: string,
): Promise<void> {
  const workspace = workspaceRoot();

  await resolveRealWithinWorkspace(templatePath, workspace, 'template');
  await refuseLinkedOutput(await resolveRealWithinWorkspace(outputPath, workspace, 'output'), outputPath);

  // An empty `partials-dir` means "no partials", which is not a path at all.
  if (partialsDir.trim() !== '') {
    await resolveRealWithinWorkspace(partialsDir, workspace, 'partials-dir');
  }
}

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
    const partialsDir = getInput('partials-dir');
    const check = getBooleanInput('check');

    await assertPathsWithinWorkspace(templatePath, outputPath, partialsDir);

    core.info(`${check ? 'Checking' : 'Rendering'} ${quoteForLog(outputPath)} from ${quoteForLog(templatePath)}...`);

    const result = await generateFile({
      templatePath,
      outputPath,
      variables: getInput('variables'),
      partialsDir,
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
      core.info(`✅ ${quoteForLog(outputPath)} is up to date.`);
      return;
    }

    core.info(
      result.changed
        ? `✅ Wrote ${quoteForLog(outputPath)}.`
        : `✅ ${quoteForLog(outputPath)} was already up to date; left untouched.`,
    );
  });
}
