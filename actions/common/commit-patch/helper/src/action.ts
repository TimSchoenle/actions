import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { parseRepository, runAction } from 'actions-util';
import { createCommitApi } from 'actions-util/commit-on-branch';
import { isCommitSha, parseByteLimit, validateArtifactName } from 'actions-util/patch';

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

/** The inputs both modes validate, so a misconfiguration fails before anything is downloaded. */
function readRequest(directory: string): CommitPatchRequest {
  const expectedHeadSha = getInput(ActionInput.expected_head_sha, { required: true });
  if (!isCommitSha(expectedHeadSha)) {
    throw new Error(`expected_head_sha must be a full lowercase commit SHA; got ${JSON.stringify(expectedHeadSha)}.`);
  }

  const repository = getInput(ActionInput.repository, { required: true });
  parseRepository(repository);

  return {
    branch: getInput(ActionInput.branch, { required: true }),
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
 * written to. `commit` then validates what was downloaded and commits it.
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
      setOutput(ActionOutput.directory, await mkdtemp(path.join(context.temp, `commit-patch-${artifactName}-`)));
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
