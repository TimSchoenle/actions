import { runAction } from 'actions-util';
import { createCommitApi } from 'actions-util/commit-on-branch';
import * as core from 'actions-util/core';

import { commitChanges } from './commit.js';
import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { createGit } from './git.js';
import { createWorkspace } from './workspace.js';

import type { CommitChangesDeps, CommitChangesResult } from './commit.js';

/** Publishes the outputs, mirroring the compatibility outputs of the previous composite version. */
function report(result: CommitChangesResult): void {
  setOutput(ActionOutput.changes_detected, String(result.committed));

  if (result.expectedHeadSource === 'remote') {
    core.warning(
      'The target branch is not checked out, so the commit expected the branch head read just before it. ' +
        'A push that landed after the checkout was not detected. Check out the branch or set expected_head_sha.',
    );
  }

  if (result.committed) {
    core.info(`✅ Commit created: ${result.commitHash}`);
    setOutput(ActionOutput.commit_hash, result.commitHash ?? '');
    setOutput(ActionOutput.commit_url, result.commitUrl ?? '');
  } else {
    core.info('ℹ️ No changes detected — skipping commit');
  }
}

/**
 * One path per line of `literal_paths`, kept as written apart from a Windows line ending. Blank lines
 * are skipped, so a block scalar's trailing newline adds nothing.
 */
export function parseLiteralPaths(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '');
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
    const literalPaths = parseLiteralPaths(getInput(ActionInput.literal_paths));
    const expectedHeadSha = getInput(ActionInput.expected_head_sha);

    const deps: CommitChangesDeps = {
      api: overrides.api ?? createCommitApi(token),
      git: overrides.git ?? createGit(),
      workspace: overrides.workspace ?? createWorkspace(),
    };

    const result = await commitChanges(deps, {
      branch,
      expectedHeadSha,
      filePattern,
      literalPaths,
      message,
      repository,
    });

    report(result);
  });
}
