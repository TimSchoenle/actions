import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  checkArtifactRecord,
  installBundles,
  isSha256Hex,
  MANIFEST_FILE,
  toAbsolute,
  toRepoPath,
  verifyBundleDirectory,
} from 'action-graph';
import { parseRepository, runAction } from 'actions-util';
import * as core from 'actions-util/core';

import { createArtifactLookup } from './artifact-api.js';
import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';

import type { ArtifactLookup } from './artifact-api.js';

/** The variable later steps find the installed manifest under; the e2e harness reads it. */
export const MANIFEST_ENV = 'BUILT_ACTIONS_MANIFEST';

/** The process-level facts this helper reads, gathered in one place so tests can supply them. */
export interface RunnerContext {
  readonly workspace: string;
  readonly temp: string;
  /** This run's ID, `GITHUB_RUN_ID`, which an empty `run-id` stands for. */
  readonly runId: string;
  /** The `GITHUB_ENV` file, where the manifest path is exported for later steps. */
  readonly envFile: string | undefined;
}

function readRunnerContext(): RunnerContext {
  return {
    envFile: process.env['GITHUB_ENV'],
    runId: process.env['GITHUB_RUN_ID'] ?? '',
    temp: process.env['RUNNER_TEMP'] || tmpdir(),
    workspace: process.env['GITHUB_WORKSPACE'] || process.cwd(),
  };
}

/** Injection seam for tests; defaults to the real GitHub API. */
export interface InstallOverrides {
  readonly lookup?: (token: string) => ArtifactLookup;
}

const POSITIVE_ID = /^[1-9]\d{0,19}$/;

function readId(value: string, input: string): number {
  const id = Number(value);
  if (!POSITIVE_ID.test(value) || !Number.isSafeInteger(id)) {
    throw new Error(`${input} must be a positive whole number; got ${JSON.stringify(value)}.`);
  }

  return id;
}

function readManifestSha256(): string {
  const value = getInput(ActionInput.expected_manifest_sha256, { required: true });
  if (!isSha256Hex(value)) {
    throw new Error(
      `expected-manifest-sha256 must be 64 lowercase hexadecimal characters; got ${JSON.stringify(value)}.`,
    );
  }

  return value;
}

function readReplace(): boolean {
  const value = getInput(ActionInput.replace);
  if (value !== 'true' && value !== 'false') {
    throw new Error(`replace must be true or false; got ${JSON.stringify(value)}.`);
  }

  return value === 'true';
}

/** The checkout to install into, which must already exist. */
function readTargetRoot(context: RunnerContext): string {
  const input = getInput(ActionInput.path) || '.';
  const root = toAbsolute(context.workspace, toRepoPath(input, 'path'));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`path ${JSON.stringify(input)} is not a directory of the workspace.`);
  }

  return root;
}

/** Every input both modes read, validated up front. */
function readCommonInputs(context: RunnerContext): { artifactId: number; manifestSha256: string; targetRoot: string } {
  return {
    artifactId: readId(getInput(ActionInput.artifact_id, { required: true }), 'artifact-id'),
    manifestSha256: readManifestSha256(),
    targetRoot: readTargetRoot(context),
  };
}

async function prepare(context: RunnerContext, overrides: InstallOverrides): Promise<void> {
  const { artifactId } = readCommonInputs(context);
  readReplace();
  const repository = parseRepository(getInput(ActionInput.repository, { required: true }));
  const runInput = getInput(ActionInput.run_id);
  const runId = readId(runInput === '' ? context.runId : runInput, runInput === '' ? 'GITHUB_RUN_ID' : 'run-id');
  const token = getInput(ActionInput.token);
  const digest = getInput(ActionInput.expected_artifact_digest);

  if (runInput !== '' && token === '') {
    throw new Error('run-id names another run, which download-artifact can only read with github-token.');
  }
  if (digest !== '') {
    if (token === '') {
      throw new Error('expected-artifact-digest needs github-token with actions: read to look the artifact up.');
    }
    const lookup = (overrides.lookup ?? createArtifactLookup)(token);
    checkArtifactRecord(await lookup(repository, artifactId), { id: artifactId, digest, runId });
    core.info(`Artifact ${artifactId} of run ${runId} carries the expected digest.`);
  }

  const directory = fs.mkdtempSync(path.join(context.temp, 'install-built-actions-'));
  setOutput(ActionOutput.artifact_id, String(artifactId));
  setOutput(ActionOutput.run_id, String(runId));
  setOutput(ActionOutput.directory, directory);
}

/** Appends `name=value` to `GITHUB_ENV`. The value is a path this helper created, checked to be one line. */
function exportVariable(context: RunnerContext, name: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Cannot export ${name}: the value spans lines.`);
  }
  if (context.envFile === undefined || context.envFile === '') {
    core.warning(`GITHUB_ENV is not set; ${name} is not exported.`);
    return;
  }
  fs.appendFileSync(context.envFile, `${name}=${value}\n`);
}

/**
 * Whether `child` lies strictly below `parent`: not `parent` itself, not outside it, and not on
 * another drive. Compared by path segment, so a child named `..foo` is inside.
 *
 * @param pathApi - the platform's path module; replaceable so the Windows rules can be tested anywhere
 */
export function isStrictlyWithin(parent: string, child: string, pathApi: typeof path = path): boolean {
  const relative = pathApi.relative(parent, child);

  return (
    relative !== '' && relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative)
  );
}

function install(context: RunnerContext): void {
  const { manifestSha256, targetRoot } = readCommonInputs(context);
  const replace = readReplace();
  const directory = getInput(ActionInput.directory, { required: true });
  if (!path.isAbsolute(directory) || !isStrictlyWithin(context.temp, directory)) {
    throw new Error(`directory must be the download directory under RUNNER_TEMP; got ${JSON.stringify(directory)}.`);
  }

  const verified = verifyBundleDirectory(directory, manifestSha256);
  const installed = installBundles(verified, targetRoot, replace);
  const manifestPath = path.join(directory, MANIFEST_FILE);

  core.info(
    `Installed ${installed.length} bundle(s) built from ${verified.manifest.sourceSha}` +
      `${verified.manifest.toolchain === '' ? '' : ` with ${verified.manifest.toolchain}`}.`,
  );
  exportVariable(context, MANIFEST_ENV, manifestPath);
  setOutput(ActionOutput.manifest_path, manifestPath);
  setOutput(ActionOutput.bundles, JSON.stringify(installed));
}

/**
 * The bundle `release/install-built-actions` runs around the download.
 *
 * `prepare` decides which archive may be downloaded; `install` decides whether its content may be
 * used. Nothing is copied into the checkout until every file has been checked against the manifest
 * hash, which comes from the build job's outputs and not from the artifact.
 */
export function run(context: RunnerContext = readRunnerContext(), overrides: InstallOverrides = {}): Promise<void> {
  return runAction(async () => {
    const mode = getInput(ActionInput.mode, { required: true });
    if (mode === 'prepare') {
      await prepare(context, overrides);
    } else if (mode === 'install') {
      install(context);
    } else {
      throw new Error(`mode must be prepare or install; got ${JSON.stringify(mode)}.`);
    }
  });
}
