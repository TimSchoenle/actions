import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { hasControlCharacter, parsePathList, toAbsolute, toRepoPath } from 'action-graph';
import { runAction } from 'actions-util';
import * as core from 'actions-util/core';

import { buildAndStage, runShell } from './build.js';
import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';

import type { ShellRunner } from './build.js';

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

/** upload-artifact's own rule for a name, checked here so a bad one fails before the build runs. */
const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The longest retention GitHub allows on a public repository. */
const MAX_RETENTION_DAYS = 90;

const MAX_TOOLCHAIN_LENGTH = 200;

function readArtifactName(): string {
  const name = getInput(ActionInput.artifact_name, { required: true });
  if (!ARTIFACT_NAME.test(name)) {
    throw new Error(
      `artifact-name must be 1 to 100 letters, digits, '.', '_' and '-', starting with a letter or digit; got ${JSON.stringify(name)}.`,
    );
  }

  return name;
}

function readRetentionDays(): string {
  const value = getInput(ActionInput.retention_days);
  const days = Number(value);
  if (!/^\d+$/.test(value) || days < 1 || days > MAX_RETENTION_DAYS) {
    throw new Error(
      `retention-days must be a whole number from 1 to ${MAX_RETENTION_DAYS}; got ${JSON.stringify(value)}.`,
    );
  }

  return String(days);
}

function readSourceSha(): string {
  const sha = getInput(ActionInput.source_sha, { required: true });
  if (!/^[0-9a-f]{40}$/.test(sha) && !/^[0-9a-f]{64}$/.test(sha)) {
    throw new Error(`source-sha must be a full lowercase commit id; got ${JSON.stringify(sha)}.`);
  }

  return sha;
}

function readToolchain(): string {
  const toolchain = getInput(ActionInput.toolchain);
  if (toolchain.length > MAX_TOOLCHAIN_LENGTH || hasControlCharacter(toolchain)) {
    throw new Error(`toolchain must be at most ${MAX_TOOLCHAIN_LENGTH} characters on one line.`);
  }

  return toolchain;
}

function readPerDirectory(): boolean {
  const value = getInput(ActionInput.per_directory);
  if (value !== 'true' && value !== 'false') {
    throw new Error(`per-directory must be true or false; got ${JSON.stringify(value)}.`);
  }

  return value === 'true';
}

/** Wraps each build run in a collapsible log group named after its directory. */
function groupedShell(shell: ShellRunner): ShellRunner {
  return async (command, cwd, env) => {
    core.startGroup(`Build ${env['BUILD_DIR'] ?? 'all build directories'}`);
    try {
      return await shell(command, cwd, env);
    } finally {
      core.endGroup();
    }
  };
}

/**
 * The bundle `release/build-actions` runs before uploading the artifact.
 *
 * Every input is validated before the build command runs, so a typo in the artifact name does not
 * cost a full build. The staging directory is created fresh under `RUNNER_TEMP`, outside the
 * checkout, so the artifact never includes anything the build left next to the bundles.
 */
export function run(context: RunnerContext = readRunnerContext(), shell: ShellRunner = runShell): Promise<void> {
  return runAction(async () => {
    const artifactName = readArtifactName();
    const retentionDays = readRetentionDays();
    const sourceSha = readSourceSha();
    const toolchain = readToolchain();
    const perDirectory = readPerDirectory();
    const command = getInput(ActionInput.build_command, { required: true });
    const buildDirs = parsePathList(getInput(ActionInput.build_dirs, { required: true }), 'build directory');
    if (buildDirs.length === 0) {
      throw new Error('build-dirs lists no directory.');
    }
    const root = toAbsolute(context.workspace, toRepoPath(getInput(ActionInput.path) || '.', 'path'));

    const stagingDirectory = fs.mkdtempSync(path.join(context.temp, 'built-actions-'));
    const staged = await buildAndStage(
      { root, buildDirs, command, perDirectory, sourceSha, toolchain, stagingDirectory },
      groupedShell(shell),
    );

    core.info(`Staged ${staged.manifest.files.length} bundle(s); bundles.json SHA-256 ${staged.manifestSha256}.`);
    setOutput(ActionOutput.directory, stagingDirectory);
    setOutput(ActionOutput.artifact_name, artifactName);
    setOutput(ActionOutput.retention_days, retentionDays);
    setOutput(ActionOutput.manifest_sha256, staged.manifestSha256);
    setOutput(ActionOutput.bundles, JSON.stringify(staged.manifest.files));
  });
}
