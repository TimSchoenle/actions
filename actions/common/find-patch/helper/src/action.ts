import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { parseRepository, runAction } from 'actions-util';
import { isCommitSha, parseByteLimit, validateArtifactName } from 'actions-util/patch';

import { assertArchiveSize, findArtifacts, inspectArtifact } from './find.js';
import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { createArtifactApi } from './github-api.js';

import type { ArtifactApi } from './find.js';
import type { RepositoryCoordinates } from 'actions-util';

/** The process-level facts this helper reads, gathered in one place so tests can supply them. */
export interface RunnerContext {
  /** Per-job scratch space: `RUNNER_TEMP`, or the system temporary directory outside a runner. */
  readonly temp: string;
  /** This run's ID, `GITHUB_RUN_ID`, which an empty `run_id` stands for. Empty outside a runner. */
  readonly runId: string;
}

/** Reads the {@link RunnerContext} from the runner's environment. */
function readRunnerContext(): RunnerContext {
  return {
    runId: process.env['GITHUB_RUN_ID'] ?? '',
    temp: process.env['RUNNER_TEMP'] || tmpdir(),
  };
}

/** Injection seam for tests; defaults to the real GitHub API. */
export interface FindPatchOverrides {
  api: ArtifactApi;
}

/** A positive decimal workflow run ID. */
const RUN_ID = /^[1-9][0-9]{0,19}$/;

/**
 * Resolves `run_id`: the input when given, this run's ID when empty.
 *
 * Read untrimmed, as commit-patch reads it: a value with stray whitespace is a misconfiguration to
 * report, not one to repair silently.
 */
function resolveRunId(context: RunnerContext): number {
  const input = getInput(ActionInput.run_id, { trimWhitespace: false });
  const value = input === '' ? context.runId : input;

  if (!RUN_ID.test(value)) {
    throw new Error(
      input === ''
        ? 'run_id is empty and GITHUB_RUN_ID is not set; pass the run to look in.'
        : `run_id must be empty or a workflow run ID; got ${JSON.stringify(input)}.`,
    );
  }

  const runId = Number(value);
  if (!Number.isSafeInteger(runId)) {
    throw new Error(`run_id ${value} is larger than any workflow run ID.`);
  }

  return runId;
}

/** The inputs both modes validate, so a misconfiguration fails before anything is listed or read. */
interface Request {
  artifactName: string;
  expectedHeadSha: string;
  maxPatchBytes: number;
  repository: RepositoryCoordinates;
}

/** Reads and validates the inputs both modes share. */
function readRequest(): Request {
  const artifactName = validateArtifactName(getInput(ActionInput.artifact_name, { required: true }));

  const expectedHeadSha = getInput(ActionInput.expected_head_sha);
  if (expectedHeadSha !== '' && !isCommitSha(expectedHeadSha)) {
    throw new Error(
      `expected_head_sha must be empty or a full lowercase commit SHA; got ${JSON.stringify(expectedHeadSha)}.`,
    );
  }

  return {
    artifactName,
    expectedHeadSha,
    maxPatchBytes: parseByteLimit(getInput(ActionInput.max_patch_bytes), ActionInput.max_patch_bytes),
    repository: parseRepository(getInput(ActionInput.repository, { required: true })),
  };
}

/**
 * `lookup`: lists the run's artifacts and, when the named one is there, creates the directory
 * download-artifact extracts it into. A missing or expired artifact settles the outcome here.
 */
async function lookup(context: RunnerContext, request: Request, overrides: Partial<FindPatchOverrides>): Promise<void> {
  const runId = resolveRunId(context);
  const api = overrides.api ?? createArtifactApi(getInput(ActionInput.token, { required: true }));
  const artifacts = await findArtifacts(api, request.repository, runId, request.artifactName);
  const [newest] = artifacts;

  setOutput(ActionOutput.found, String(newest !== undefined));
  setOutput(ActionOutput.run_id, String(runId));

  if (newest === undefined) {
    core.info(
      `Workflow run ${runId} holds no unexpired artifact named ${request.artifactName}: the job that ` +
        'makes it did not run, or the artifact has expired. Nothing to commit.',
    );
    setOutput(ActionOutput.has_changes, 'false');
    setOutput(ActionOutput.outcome, 'missing');
    return;
  }
  assertArchiveSize(newest, request.maxPatchBytes);
  if (artifacts.length > 1) {
    core.warning(
      `Workflow run ${runId} holds ${artifacts.length} unexpired artifacts named ${request.artifactName} ` +
        `(${artifacts.map((artifact) => artifact.id).join(', ')}), most likely from re-run attempts. ` +
        `download-artifact fetches the newest, ${newest.id}, so that is the one inspected.`,
    );
  }

  setOutput(ActionOutput.directory, await mkdtemp(path.join(context.temp, `find-patch-${request.artifactName}-`)));
}

/** `inspect`: validates the downloaded artifact and reports what it holds. */
async function inspect(request: Request): Promise<void> {
  const directory = getInput(ActionInput.directory, { required: true });
  const { baseSha, outcome } = await inspectArtifact(directory, request.maxPatchBytes, request.expectedHeadSha);

  switch (outcome) {
    case 'branch_moved': {
      core.notice(
        `The ${request.artifactName} patch was made from ${baseSha}, not ${request.expectedHeadSha}; ` +
          'commit-patch would skip it, so it is reported as nothing to commit.',
      );
      break;
    }
    case 'changes': {
      core.info(`The ${request.artifactName} patch made from ${baseSha} has changes to commit.`);
      break;
    }
    case 'no_changes': {
      core.info(`The ${request.artifactName} patch is empty: nothing changed.`);
      break;
    }
  }

  setOutput(ActionOutput.has_changes, String(outcome === 'changes'));
  setOutput(ActionOutput.outcome, outcome);
  setOutput(ActionOutput.base_sha, baseSha);
  setOutput(ActionOutput.directory, directory);
}

/**
 * The bundle `common/find-patch` runs, once as `lookup` and once as `inspect`.
 *
 * It runs in a job holding no secret, ahead of the job that mints a write token, and decides whether
 * that job has anything to do. Everything it reads came from a run that may have executed untrusted
 * code, so the artifact is validated as strictly as commit-patch validates it, and a malformed one
 * fails the step rather than reading as "nothing to commit".
 *
 * @param overrides injection seam for tests; the API defaults to the real GitHub REST API.
 */
export function run(
  context: RunnerContext = readRunnerContext(),
  overrides: Partial<FindPatchOverrides> = {},
): Promise<void> {
  return runAction(async () => {
    const mode = getInput(ActionInput.mode, { required: true });
    if (mode !== 'lookup' && mode !== 'inspect') {
      throw new Error(`mode must be lookup or inspect; got ${JSON.stringify(mode)}.`);
    }

    const request = readRequest();

    await (mode === 'lookup' ? lookup(context, request, overrides) : inspect(request));
  });
}
