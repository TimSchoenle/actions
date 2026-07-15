import { parseRepository } from 'actions-util';

import { classifyChanges, parseChangedPaths } from './changes.js';
import { buildPathspecs } from './pathspec.js';

import type { WorkspaceReader } from './changes.js';
import type { Git } from './git.js';
import type { CommitApi } from './github-api.js';

/** The collaborators {@link commitChanges} drives, each faked independently in tests. */
export interface CommitChangesDeps {
  git: Git;
  workspace: WorkspaceReader;
  api: CommitApi;
}

/** Everything read from the action inputs that the commit needs. */
export interface CommitChangesRequest {
  /** Repository to commit to, e.g. `owner/repo`. */
  repository: string;
  /** Branch to commit to. */
  branch: string;
  /** The commit message. */
  message: string;
  /** Space-separated `file_pattern` scoping which changes are committed. */
  filePattern: string;
}

/** What the run did. `committed` is false only when nothing was committed. */
export interface CommitChangesResult {
  /** Whether a commit was created. */
  committed: boolean;
  /** Whether the working tree had changes matching the pattern. */
  hasChanges: boolean;
  /** SHA of the created commit, when one was created. */
  commitHash?: string;
  /** URL of the created commit, when one was created. */
  commitUrl?: string;
}

/**
 * Commits the working-tree changes matching `file_pattern` to the branch, using the GraphQL commit
 * API so the commit is verified.
 *
 * Nothing is committed when the tree has no matching changes. The branch head is read immediately
 * before the commit and passed as `expectedHeadOid`, so a concurrent push to the branch fails this
 * write loudly rather than being silently overwritten.
 *
 * @throws if `branch` is empty, or if the repository is malformed — a commit must never be attempted
 * against an unresolved target.
 */
export async function commitChanges(
  deps: CommitChangesDeps,
  request: CommitChangesRequest,
): Promise<CommitChangesResult> {
  if (request.branch === '') {
    throw new Error('No branch given. A branch to commit to is required.');
  }

  const coordinates = parseRepository(request.repository);

  await deps.git.ignoreFileModeChanges();

  const { specs, useFilter } = buildPathspecs(request.filePattern);
  const status = await deps.git.status(useFilter ? specs : undefined);
  const changedPaths = parseChangedPaths(status);
  const hasChanges = changedPaths.length > 0;

  if (!hasChanges) {
    return { committed: false, hasChanges: false };
  }

  const fileChanges = classifyChanges(changedPaths, deps.workspace);
  const expectedHeadOid = await deps.api.getHeadOid(coordinates, request.branch);

  const commit = await deps.api.createCommit({
    branch: request.branch,
    coordinates,
    expectedHeadOid,
    fileChanges,
    message: request.message,
  });

  return { commitHash: commit.oid, commitUrl: commit.url, committed: true, hasChanges };
}
