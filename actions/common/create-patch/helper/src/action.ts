import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runAction } from 'actions-util';
import * as core from 'actions-util/core';
import {
  describePatch,
  isCommitSha,
  METADATA_FILE_NAME,
  parseByteLimit,
  PATCH_FILE_NAME,
  serializeMetadata,
  validateArtifactName,
} from 'actions-util/patch';

import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { createPatch } from './patch.js';

import type { PatchMetadata } from 'actions-util/patch';

/** The process-level facts this helper reads, gathered in one place so tests can supply them. */
export interface RunnerContext {
  /** The checked-out repository: `GITHUB_WORKSPACE`, or the working directory outside a runner. */
  readonly workspace: string;
  /** Per-job scratch space: `RUNNER_TEMP`, or the system temporary directory outside a runner. */
  readonly temp: string;
}

function readRunnerContext(): RunnerContext {
  return {
    temp: process.env['RUNNER_TEMP'] || tmpdir(),
    workspace: process.env['GITHUB_WORKSPACE'] || process.cwd(),
  };
}

/**
 * Writes an empty patch recorded against `baseSha`, the artifact a job uploads to say "nothing to
 * commit for this head" without checking that head out. The files are the ones {@link createPatch}
 * writes for a clean tree, so commit-patch and find-patch read them the same way.
 */
async function writeEmptyPatch(baseSha: string, outputDirectory: string): Promise<PatchMetadata> {
  const patch = Buffer.alloc(0);
  const metadata = describePatch(baseSha, patch);

  await writeFile(path.join(outputDirectory, PATCH_FILE_NAME), patch, { flag: 'wx' });
  await writeFile(path.join(outputDirectory, METADATA_FILE_NAME), serializeMetadata(metadata), { flag: 'wx' });

  return metadata;
}

/**
 * The bundle `common/create-patch` runs before uploading the artifact.
 *
 * It runs in the job that has just executed the repository's own formatter or generator, so it holds
 * nothing worth stealing and trusts nothing it reads. What it produces is untrusted by design:
 * `commit-patch` revalidates every byte, and a tampered helper here can make that job refuse the
 * patch, never widen what it commits.
 *
 * The artifact directory is created fresh under `RUNNER_TEMP`, outside the checkout, so the patch is
 * never part of the tree it describes. With `empty_base_sha` no checkout is read at all.
 */
export function run(context: RunnerContext = readRunnerContext()): Promise<void> {
  return runAction(async () => {
    const artifactName = validateArtifactName(getInput(ActionInput.artifact_name, { required: true }));
    const maxPatchBytes = parseByteLimit(getInput(ActionInput.max_patch_bytes), ActionInput.max_patch_bytes);
    const paths = getInput(ActionInput.paths);
    // Untrimmed: a value with stray whitespace did not come from a context as a plain SHA.
    const emptyBaseSha = getInput(ActionInput.empty_base_sha, { trimWhitespace: false });

    if (emptyBaseSha !== '' && !isCommitSha(emptyBaseSha)) {
      throw new Error(`empty_base_sha must be a full lowercase commit SHA; got ${JSON.stringify(emptyBaseSha)}.`);
    }

    const outputDirectory = await mkdtemp(path.join(context.temp, `create-patch-${artifactName}-`));

    const metadata =
      emptyBaseSha === ''
        ? await createPatch({
            maxPatchBytes,
            outputDirectory,
            paths,
            scratchRoot: context.temp,
            workspace: context.workspace,
          })
        : await writeEmptyPatch(emptyBaseSha, outputDirectory);

    if (metadata.hasChanges) {
      core.info(`Patch of ${metadata.patchBytes} bytes against ${metadata.baseSha} (sha256 ${metadata.patchSha256}).`);
    } else {
      core.info(`No changes against ${metadata.baseSha}; uploading an empty patch.`);
    }

    setOutput(ActionOutput.has_changes, String(metadata.hasChanges));
    setOutput(ActionOutput.base_sha, metadata.baseSha);
    setOutput(ActionOutput.artifact_name, artifactName);
    setOutput(ActionOutput.directory, outputDirectory);
  });
}
