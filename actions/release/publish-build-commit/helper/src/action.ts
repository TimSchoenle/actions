import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkArtifactRecord, isSha256Hex, toAbsolute, verifyBundleDirectory } from 'action-graph';
import { parseRepository, runAction } from 'actions-util';
import * as core from 'actions-util/core';

import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { createPublishApi, fetchArtifactRecord } from './github.js';
import { matchesGlob, parseGlobs } from './glob.js';
import { Publisher } from './publish.js';
import { isSafeRefName, parseReleases } from './releases-input.js';

import type { MakeLatest, PublishApi } from './github.js';
import type { AssetPolicy, ReleaseSpec } from './publish.js';
import type { ExistingFilesPolicy } from './tree.js';
import type { ArtifactRecord } from 'action-graph';
import type { RepositoryCoordinates } from 'actions-util';

/** The process-level facts this helper reads, gathered in one place so tests can supply them. */
export interface RunnerContext {
  readonly temp: string;
  /** This run's ID: the artifact must belong to it. */
  readonly runId: string;
}

function readRunnerContext(): RunnerContext {
  return { runId: process.env['GITHUB_RUN_ID'] ?? '', temp: process.env['RUNNER_TEMP'] || tmpdir() };
}

/** Injection seams for tests; default to the real GitHub API. */
export interface PublishOverrides {
  readonly api?: (token: string, repository: RepositoryCoordinates) => PublishApi;
  readonly artifactRecord?: (token: string, repository: RepositoryCoordinates, id: number) => Promise<ArtifactRecord>;
}

/** Every input both modes read, validated. */
interface CommonInputs {
  readonly repository: RepositoryCoordinates;
  readonly token: string;
  readonly sourceSha: string;
  readonly artifactId: number;
  readonly manifestSha256: string;
  readonly allowedPaths: readonly string[];
  readonly existingFiles: ExistingFilesPolicy;
  readonly releasesBranch: string;
  readonly releases: readonly ReleaseSpec[];
  readonly assets: AssetPolicy;
  readonly makeLatest: MakeLatest;
  readonly pullRequest: number | undefined;
  readonly pendingLabel: string;
  readonly taggedLabel: string;
  readonly dryRun: boolean;
}

function oneOf<T extends string>(input: ActionInput, name: string, allowed: readonly T[]): T {
  const value = getInput(input, { required: true });
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name} must be one of ${allowed.join(', ')}; got ${JSON.stringify(value)}.`);
  }

  return value as T;
}

function positiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d{0,15}$/.test(value)) {
    throw new Error(`${name} must be a positive whole number; got ${JSON.stringify(value)}.`);
  }

  return Number(value);
}

function label(input: ActionInput, name: string): string {
  const value = getInput(input, { required: true });
  if (value.length > 50 || /[\r\n]/.test(value)) {
    throw new Error(`${name} must be one line of at most 50 characters.`);
  }

  return value;
}

function readCommonInputs(): CommonInputs {
  const token = getInput(ActionInput.token, { required: true });
  core.setSecret(token);

  const sourceSha = getInput(ActionInput.source_sha, { required: true });
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error(`source-sha must be a full lowercase commit id; got ${JSON.stringify(sourceSha)}.`);
  }
  const manifestSha256 = getInput(ActionInput.expected_manifest_sha256, { required: true });
  if (!isSha256Hex(manifestSha256)) {
    throw new Error('expected-manifest-sha256 must be 64 lowercase hexadecimal characters.');
  }
  const crossCheck = getInput(ActionInput.cross_check_manifest_sha256);
  if (crossCheck !== '' && crossCheck !== manifestSha256) {
    throw new Error(`The two builds disagree: manifest SHA-256 ${manifestSha256} and ${JSON.stringify(crossCheck)}.`);
  }
  const releasesBranch = getInput(ActionInput.releases_branch);
  if (releasesBranch !== '' && !isSafeRefName(releasesBranch)) {
    throw new Error(`releases-branch ${JSON.stringify(releasesBranch)} is not a valid branch name.`);
  }
  const allowedPaths = parseGlobs(getInput(ActionInput.allowed_paths, { required: true }));
  if (allowedPaths.length === 0) {
    throw new Error('allowed-paths lists no glob.');
  }
  const pullRequest = getInput(ActionInput.pull_request);
  const dryRun = oneOf(ActionInput.dry_run, 'dry-run', ['true', 'false'] as const);

  return {
    repository: parseRepository(getInput(ActionInput.repository, { required: true })),
    token,
    sourceSha,
    artifactId: positiveInteger(getInput(ActionInput.artifact_id, { required: true }), 'artifact-id'),
    manifestSha256,
    allowedPaths,
    existingFiles: oneOf(ActionInput.existing_files, 'existing-files', ['fail', 'require-identical'] as const),
    releasesBranch,
    releases: parseReleases(getInput(ActionInput.releases, { required: true })),
    assets: oneOf(ActionInput.release_assets, 'release-assets', ['none', 'checksums', 'bundles'] as const),
    makeLatest: oneOf(ActionInput.make_latest, 'make-latest', ['true', 'false', 'legacy'] as const),
    pullRequest: pullRequest === '' ? undefined : positiveInteger(pullRequest, 'pull-request'),
    pendingLabel: label(ActionInput.pending_label, 'pending-label'),
    taggedLabel: label(ActionInput.tagged_label, 'tagged-label'),
    dryRun: dryRun === 'true',
  };
}

async function prepare(context: RunnerContext, overrides: PublishOverrides): Promise<void> {
  const inputs = readCommonInputs();
  const digest = getInput(ActionInput.expected_artifact_digest, { required: true });
  const readToken = getInput(ActionInput.github_token, { required: true });
  const runId = positiveInteger(context.runId, 'GITHUB_RUN_ID');

  const record = await (overrides.artifactRecord ?? fetchArtifactRecord)(
    readToken,
    inputs.repository,
    inputs.artifactId,
  );
  checkArtifactRecord(record, { id: inputs.artifactId, digest, runId });
  core.info(`Artifact ${inputs.artifactId} of run ${runId} carries the expected digest.`);

  setOutput(ActionOutput.artifact_id, String(inputs.artifactId));
  setOutput(ActionOutput.directory, fs.mkdtempSync(path.join(context.temp, 'publish-build-commit-')));
}

async function publish(context: RunnerContext, overrides: PublishOverrides): Promise<void> {
  const inputs = readCommonInputs();
  const directory = getInput(ActionInput.directory, { required: true });
  if (!path.isAbsolute(directory) || path.relative(context.temp, directory).startsWith('..')) {
    throw new Error(`directory must be the download directory under RUNNER_TEMP; got ${JSON.stringify(directory)}.`);
  }

  const verified = verifyBundleDirectory(directory, inputs.manifestSha256);
  if (verified.manifest.sourceSha !== inputs.sourceSha) {
    throw new Error(
      `The bundles were built from ${verified.manifest.sourceSha}, not from source-sha ${inputs.sourceSha}.`,
    );
  }
  const outside = verified.manifest.files.filter(
    (file) => !inputs.allowedPaths.some((glob) => matchesGlob(glob, file.path)),
  );
  if (outside.length > 0) {
    throw new Error(`Bundles outside allowed-paths: ${outside.map((file) => file.path).join(', ')}.`);
  }

  const api = (overrides.api ?? createPublishApi)(inputs.token, inputs.repository);
  const result = await new Publisher(api, {
    ...inputs,
    files: verified.manifest.files,
    readFile: (file) => fs.readFileSync(toAbsolute(directory, file)),
    manifestSha256: inputs.manifestSha256,
    runUrl: getInput(ActionInput.run_url),
  }).publish();

  core.info(
    `${inputs.dryRun ? 'Dry run: ' : ''}build commit ${result.buildSha ?? '(not created)'}, tree ${result.treeSha}, ` +
      `${result.created.length} change(s).`,
  );
  for (const change of result.created) {
    core.info(`  ${change}`);
  }
  setOutput(ActionOutput.build_sha, result.buildSha ?? '');
  setOutput(ActionOutput.tree_sha, result.treeSha);
  setOutput(ActionOutput.created, JSON.stringify(result.created));
  setOutput(ActionOutput.releases, JSON.stringify(result.releases));
}

/**
 * The bundle `release/publish-build-commit` runs around the download.
 *
 * It holds a write token, so it runs no repository code and builds no command from its inputs: every
 * input is validated data, every write goes through the REST API, and nothing reaches the repository
 * before the download has been verified against the manifest hash from the build job.
 */
export function run(context: RunnerContext = readRunnerContext(), overrides: PublishOverrides = {}): Promise<void> {
  return runAction(async () => {
    const mode = getInput(ActionInput.mode, { required: true });
    if (mode === 'prepare') {
      await prepare(context, overrides);
    } else if (mode === 'publish') {
      await publish(context, overrides);
    } else {
      throw new Error(`mode must be prepare or publish; got ${JSON.stringify(mode)}.`);
    }
  });
}
