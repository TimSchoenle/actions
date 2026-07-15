import * as core from '@actions/core';
import { runAction } from 'actions-util';

import { commitChanges } from './commit.js';
import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createGit } from './git.js';
import { createCommitApi } from './github-api.js';
import { createWorkspace } from './workspace.js';

import type { CommitChangesDeps, CommitChangesResult } from './commit.js';

/** Publishes the outputs, mirroring the compatibility outputs of the previous composite version. */
function report(result: CommitChangesResult): void {
  setOutput(ActionOutput.changes_detected, String(result.committed));

  if (result.committed) {
    core.info(`✅ Commit created: ${result.commitHash}`);
    setOutput(ActionOutput.commit_hash, result.commitHash ?? '');
    setOutput(ActionOutput.commit_url, result.commitUrl ?? '');
  } else {
    core.info('ℹ️ No changes detected and empty commits are disabled — skipping commit');
  }
}

/**
 * Reads the action inputs, commits the matching working-tree changes and publishes the results.
 *
 * @param overrides injection seam for tests; each collaborator defaults to the real git executable,
 * filesystem and GitHub GraphQL API.
 */
export function run(overrides: Partial<CommitChangesDeps> = {}): Promise<void> {
  return runAction(async () => {
    const message = getInput(ActionInput.commit_message, { required: true });
    const token = getInput(ActionInput.token, { required: true });
    // repository and branch carry defaults resolved from the workflow context in action.yaml; an
    // empty branch is reported by commitChanges with a message naming the branch, not the input.
    const repository = getInput(ActionInput.repository);
    const branch = getInput(ActionInput.branch);
    const filePattern = getInput(ActionInput.file_pattern);
    const empty = getBooleanInput(ActionInput.empty);

    const deps: CommitChangesDeps = {
      api: overrides.api ?? createCommitApi(token),
      git: overrides.git ?? createGit(),
      workspace: overrides.workspace ?? createWorkspace(),
    };

    const result = await commitChanges(deps, { branch, empty, filePattern, message, repository });

    report(result);
  });
}
