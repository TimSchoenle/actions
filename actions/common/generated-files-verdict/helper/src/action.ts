import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { runAction } from 'actions-util';
import { parseByteLimit, validateArtifactName } from 'actions-util/patch';

import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { applyPatches, downloadPath, downloadPattern, evaluateNeeds, inspectPatches, parseNeeds } from './verdict.js';

/** The process-level facts this helper reads, gathered in one place so tests can supply them. */
export interface RunnerContext {
  /** Per-job scratch space: `RUNNER_TEMP`, or the system temporary directory outside a runner. */
  readonly temp: string;
  /** The checkout the patches are applied to: `GITHUB_WORKSPACE`, or the working directory. */
  readonly workspace: string;
}

function readRunnerContext(): RunnerContext {
  return {
    temp: process.env['RUNNER_TEMP'] || tmpdir(),
    workspace: process.env['GITHUB_WORKSPACE'] || process.cwd(),
  };
}

/** An output name as GitHub accepts it: a letter or `_`, then letters, digits, `-` and `_`. */
const OUTPUT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function readOutputName(input: ActionInput): string {
  const value = getInput(input, { required: true });
  if (!OUTPUT_NAME.test(value)) {
    throw new Error(`${input} must be a job output name; got ${JSON.stringify(value)}.`);
  }
  return value;
}

/** Parses the `artifacts` input evaluate mode produced: a JSON array of artifact names. */
function readArtifacts(): string[] {
  const text = getInput(ActionInput.artifacts, { required: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`artifacts must be a JSON array of artifact names; got ${JSON.stringify(text)}.`);
  }
  if (!Array.isArray(parsed) || parsed.some((name) => typeof name !== 'string')) {
    throw new Error(`artifacts must be a JSON array of artifact names; got ${JSON.stringify(text)}.`);
  }
  return parsed.map((name: string) => validateArtifactName(name));
}

/** `evaluate`: reads the needs context and prepares the download of the pending patches. */
async function evaluate(context: RunnerContext): Promise<void> {
  const jobs = parseNeeds(getInput(ActionInput.needs, { required: true }));
  const evaluation = evaluateNeeds(
    jobs,
    readOutputName(ActionInput.changes_output),
    readOutputName(ActionInput.artifact_output),
    validateArtifactName(getInput(ActionInput.merged_artifact, { required: true })),
  );

  core.info(`Generator jobs: ${jobs.map((job) => `${job.id}=${job.result}`).join(', ')}.`);
  for (const [index, job] of evaluation.pendingJobs.entries()) {
    core.info(`${job} left changes in ${evaluation.artifacts[index]}.`);
  }

  const hasPending = evaluation.pendingJobs.length > 0;
  setOutput(ActionOutput.failed_jobs, evaluation.failedJobs.join(' '));
  setOutput(ActionOutput.pending_jobs, evaluation.pendingJobs.join(' '));
  setOutput(ActionOutput.artifacts, JSON.stringify(evaluation.artifacts));
  setOutput(ActionOutput.download_pattern, downloadPattern(evaluation.artifacts));
  setOutput(ActionOutput.has_pending, String(hasPending));
  const directory = hasPending ? await mkdtemp(path.join(context.temp, 'generated-files-verdict-')) : '';
  setOutput(ActionOutput.directory, directory);
  setOutput(ActionOutput.download_path, downloadPath(directory, evaluation.artifacts));
}

/** `inspect`: validates the downloaded patches and reports the commit they share. */
async function inspect(): Promise<void> {
  const { baseSha } = await inspectPatches(
    getInput(ActionInput.directory, { required: true }),
    readArtifacts(),
    parseByteLimit(getInput(ActionInput.max_patch_bytes), ActionInput.max_patch_bytes),
  );
  core.info(`Every pending patch was made from ${baseSha}.`);
  setOutput(ActionOutput.base_sha, baseSha);
}

/** `apply`: applies the patches, in `needs` order, to the checkout of their base. */
async function apply(context: RunnerContext): Promise<void> {
  const artifacts = readArtifacts();
  const { patches } = await inspectPatches(
    getInput(ActionInput.directory, { required: true }),
    artifacts,
    parseByteLimit(getInput(ActionInput.max_patch_bytes), ActionInput.max_patch_bytes),
  );
  await applyPatches(context.workspace, artifacts, patches);
  core.info(`Applied ${artifacts.join(', ')}.`);
}

/**
 * The bundle `common/generated-files-verdict` runs in its evaluate, inspect and apply steps.
 *
 * It runs in the pull_request run, beside generator jobs that may have executed the pull request's
 * code, so it holds no secret and treats every patch as untrusted: each is read with commit-patch's
 * strict reader, and only `git apply`, which refuses paths outside the work tree, touches the
 * checkout. Whether to fail is decided by the composite's last step, after the merged patch is
 * uploaded, so the commit job always has something to fetch.
 */
export function run(context: RunnerContext = readRunnerContext()): Promise<void> {
  return runAction(async () => {
    const mode = getInput(ActionInput.mode, { required: true });
    switch (mode) {
      case 'evaluate': {
        await evaluate(context);
        return;
      }
      case 'inspect': {
        await inspect();
        return;
      }
      case 'apply': {
        await apply(context);
        return;
      }
      default: {
        throw new Error(`mode must be evaluate, inspect or apply; got ${JSON.stringify(mode)}.`);
      }
    }
  });
}
