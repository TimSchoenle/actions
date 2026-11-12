import { mkdtemp, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseRepository, runAction } from 'actions-util';
import { createCommitApi } from 'actions-util/commit-on-branch';
import * as core from 'actions-util/core';
import { isCommitSha, parseByteLimit, validateArtifactName } from 'actions-util/patch';

import { validateBranchName } from './branch-name.js';
import { commitPatch } from './commit.js';
import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createPatchGit } from './git.js';
import { compileAllowlist } from './glob.js';

import type { CommitPatchDeps, CommitPatchRequest, CommitPatchResult } from './commit.js';

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
 * Checks `run_id`: empty, or a positive decimal run ID. The composite picks its download step from
 * whether the raw input is empty, so the value is read untrimmed and anything else fails here, before
 * either step runs.
 */
function validateRunId(value: string): void {
  if (value !== '' && !/^[1-9][0-9]{0,19}$/.test(value)) {
    throw new Error(`run_id must be empty or a workflow run ID; got ${JSON.stringify(value)}.`);
  }
}

/**
 * An input whose default is a value of the triggering event.
 *
 * Without `run_id` the event is the one that produced the patch, so its value is the right default.
 * With `run_id` the job is typically a `workflow_run` job, whose event values name the default branch
 * and its tip: a fallback there would commit another run's patch to the default branch.
 */
function readEventDefault(input: ActionInput, eventInput: ActionInput, runId: string): string {
  const explicit = getInput(input);

  if (explicit !== '') {
    return explicit;
  }

  if (runId !== '') {
    throw new Error(
      `${input} must be set when run_id is set: the triggering event does not describe the run the patch came from.`,
    );
  }

  const fallback = getInput(eventInput);

  if (fallback === '') {
    throw new Error(`${input} is empty, and the triggering event names none.`);
  }

  return fallback;
}

/** The inputs both modes validate, so a misconfiguration fails before anything is downloaded. */
function readRequest(directory: string): CommitPatchRequest {
  const runId = getInput(ActionInput.run_id, { trimWhitespace: false });
  validateRunId(runId);

  const branch = validateBranchName(readEventDefault(ActionInput.branch, ActionInput.event_branch, runId));
  const expectedHeadSha = readEventDefault(ActionInput.expected_head_sha, ActionInput.event_head_sha, runId);
  if (!isCommitSha(expectedHeadSha)) {
    throw new Error(`expected_head_sha must be a full lowercase commit SHA; got ${JSON.stringify(expectedHeadSha)}.`);
  }

  const repository = getInput(ActionInput.repository, { required: true });
  parseRepository(repository);

  return {
    branch,
    directory,
    expectedHeadSha,
    maxPatchBytes: parseByteLimit(getInput(ActionInput.max_patch_bytes), ActionInput.max_patch_bytes),
    message: getInput(ActionInput.commit_message, { required: true }),
    policy: {
      allowBinary: getBooleanInput(ActionInput.allow_binary),
      allowWorkflowChanges: getBooleanInput(ActionInput.allow_workflow_changes),
      allowlist: compileAllowlist(getInput(ActionInput.allowed_paths, { required: true })),
    },
    repository,
  };
}

/** Whether `child` is `parent` itself or lies below it. Both must be resolved, absolute paths. */
function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Checks a `source_directory`: an existing directory strictly below the runner temporary directory
 * and outside the checkout, after symbolic links are resolved. That is where find-patch and
 * download-artifact leave an artifact, and where no pull request file lands. Its contents are still
 * untrusted and validated in commit mode like a fresh download.
 *
 * @returns the resolved path.
 */
async function validateSourceDirectory(value: string, context: RunnerContext): Promise<string> {
  if (!path.isAbsolute(value)) {
    throw new Error(`directory must be an absolute path; got ${JSON.stringify(value)}.`);
  }

  let resolved: string;

  try {
    resolved = await realpath(value);
  } catch {
    throw new Error(`directory ${JSON.stringify(value)} does not exist.`);
  }

  if (!(await stat(resolved)).isDirectory()) {
    throw new Error(`directory ${JSON.stringify(value)} is not a directory.`);
  }

  const temp = await realpath(context.temp);
  const workspace = await realpath(context.workspace).catch(() => path.resolve(context.workspace));

  if (resolved === temp || !isWithin(temp, resolved)) {
    throw new Error(`directory must lie below the runner temporary directory; got ${JSON.stringify(value)}.`);
  }

  if (isWithin(workspace, resolved)) {
    throw new Error(`directory must lie outside the checkout; got ${JSON.stringify(value)}.`);
  }

  return resolved;
}

/** Publishes the commit-mode outputs. */
function report(result: CommitPatchResult): void {
  setOutput(ActionOutput.outcome, result.outcome);
  setOutput(ActionOutput.changes_committed, String(result.outcome === 'committed'));
  setOutput(ActionOutput.commit_sha, result.commitSha ?? '');
  setOutput(ActionOutput.commit_url, result.commitUrl ?? '');

  if (result.outcome === 'committed') {
    core.info(`Commit created: ${result.commitSha}`);
  }
}

/**
 * The bundle `common/commit-patch` runs, once as `prepare` and once as `commit`.
 *
 * `prepare` validates every input and creates a fresh, empty directory under `RUNNER_TEMP` for
 * download-artifact, so the artifact lands outside the checkout and in a directory nothing else has
 * written to. Given a `source_directory` that already holds the artifact, it checks that directory
 * and returns it instead, and the composite downloads nothing. `commit` then validates what is in
 * the directory and commits it.
 *
 * @param overrides injection seam for tests; each collaborator defaults to the real git executable
 * and GitHub API.
 */
export function run(
  context: RunnerContext = readRunnerContext(),
  overrides: Partial<CommitPatchDeps> = {},
): Promise<void> {
  return runAction(async () => {
    const mode = getInput(ActionInput.mode, { required: true });
    const artifactName = validateArtifactName(getInput(ActionInput.artifact_name, { required: true }));

    if (mode === 'prepare') {
      readRequest('');
      const source = getInput(ActionInput.source_directory);
      const directory =
        source === ''
          ? await mkdtemp(path.join(context.temp, `commit-patch-${artifactName}-`))
          : await validateSourceDirectory(source, context);
      setOutput(ActionOutput.directory, directory);
      return;
    }

    if (mode !== 'commit') {
      throw new Error(`mode must be prepare or commit; got ${JSON.stringify(mode)}.`);
    }

    const request = readRequest(getInput(ActionInput.directory, { required: true }));
    const token = getInput(ActionInput.token, { required: true });

    const deps: CommitPatchDeps = {
      api: overrides.api ?? createCommitApi(token),
      git: overrides.git ?? createPatchGit(context.workspace, context.temp),
      info: overrides.info ?? ((message) => core.info(message)),
      notice: overrides.notice ?? ((message) => core.notice(message)),
    };

    report(await commitPatch(deps, request));
  });
}
