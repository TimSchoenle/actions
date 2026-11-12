import { parseRepository } from 'actions-util';
import { buildPathspecs, isCommitSha } from 'actions-util/patch';

import { classifyChanges, parseChangedPaths } from './changes.js';

import type { WorkspaceReader } from './changes.js';
import type { Git } from './git.js';
import type { CommitApi } from 'actions-util/commit-on-branch';

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
  /** The commit the branch must still point at. Empty derives it, see {@link resolveExpectedHead}. */
  expectedHeadSha: string;
  /** The commit message. */
  message: string;
  /** Space-separated `file_pattern` scoping which changes are committed. */
  filePattern: string;
}

/**
 * Where the commit's expected head came from: the `expected_head_sha` input, the checked-out branch,
 * or the remote branch read just before the commit.
 */
export type ExpectedHeadSource = 'checkout' | 'input' | 'remote';

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
  /** Where the expected head came from, when a commit was attempted. */
  expectedHeadSource?: ExpectedHeadSource;
}

/**
 * The head the commit must apply to.
 *
 * The working-tree files were rewritten on top of the checkout, so the checkout's commit is the one
 * they describe. Passing it as `expectedHeadOid` makes GitHub refuse the commit if the branch moved
 * since, instead of silently overwriting the files a later push changed. The remote head is read only
 * when nothing better is known: another branch, or a detached `HEAD`, is checked out.
 */
async function resolveExpectedHead(
  deps: CommitChangesDeps,
  request: CommitChangesRequest,
  coordinates: ReturnType<typeof parseRepository>,
): Promise<{ oid: string; source: ExpectedHeadSource }> {
  if (request.expectedHeadSha !== '') {
    return { oid: request.expectedHeadSha, source: 'input' };
  }

  const checkedOut = await deps.git.checkedOutHead(request.branch);

  if (checkedOut !== undefined) {
    return { oid: checkedOut, source: 'checkout' };
  }

  return { oid: await deps.api.getHeadOid(coordinates, request.branch), source: 'remote' };
}

/**
 * Commits the working-tree changes matching `file_pattern` to the branch, using the GraphQL commit
 * API so the commit is verified.
 *
 * Nothing is committed when the tree has no matching changes. The commit is pinned to an expected head
 * (see {@link resolveExpectedHead}), and GitHub refuses it when the branch no longer points there.
 * Only when the head has to be read from the remote at commit time does a push that landed between
 * checkout and commit go undetected.
 *
 * @throws if `branch` is empty, `expectedHeadSha` is set but not a full commit SHA, or the repository
 * is malformed — a commit must never be attempted against an unresolved target.
 */
export async function commitChanges(
  deps: CommitChangesDeps,
  request: CommitChangesRequest,
): Promise<CommitChangesResult> {
  if (request.branch === '') {
    throw new Error('No branch given. A branch to commit to is required.');
  }

  if (request.expectedHeadSha !== '' && !isCommitSha(request.expectedHeadSha)) {
    throw new Error(
      `expected_head_sha must be a full lowercase commit SHA; got ${JSON.stringify(request.expectedHeadSha)}.`,
    );
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
  const expectedHead = await resolveExpectedHead(deps, request, coordinates);

  const commit = await deps.api.createCommit({
    branch: request.branch,
    coordinates,
    expectedHeadOid: expectedHead.oid,
    fileChanges,
    message: request.message,
  });

  return {
    commitHash: commit.oid,
    commitUrl: commit.url,
    committed: true,
    expectedHeadSource: expectedHead.source,
    hasChanges,
  };
}
