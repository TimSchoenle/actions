import { parseRepository } from 'actions-util';
import { resolveBranchOrDefault } from 'actions-util/branches';

import type { BranchOrigin, BranchApi as GitBranchApi } from 'actions-util/branches';

/** The repository operations this action needs, kept minimal so it can be faked in tests. */
export type BranchApi = Pick<GitBranchApi, 'branchExists' | 'getDefaultBranch'>;

export interface ResolveRequest {
  /** Repository to resolve the branch in, e.g. `owner/repo`. */
  repository: string;
  /** Branch to resolve. Empty resolves the repository's default branch. */
  branchName: string;
  /** Whether the resolved branch must be verified to exist. */
  checkIfExist: boolean;
}

export interface ResolveResult {
  /** The resolved branch name. */
  branch: string;
  /** Where the branch came from — useful for logging and for the caller's audit trail. */
  origin: BranchOrigin;
  /** Whether the branch was verified to exist. `undefined` when the check was disabled. */
  exists: boolean | undefined;
}

/**
 * Raised when a branch cannot be resolved for a legitimate, expected reason: the requested branch
 * does not exist.
 *
 * Distinct from transport or authorization failures, which must never be silenced — a broken token
 * would otherwise be indistinguishable from a missing branch.
 */
export class BranchNotFoundError extends Error {
  constructor(
    readonly repository: string,
    readonly branch: string,
  ) {
    super(`Branch '${branch}' does not exist in repository: ${repository}`);
    this.name = 'BranchNotFoundError';
  }
}

/**
 * Confirms the repository itself is reachable before reporting a branch as merely absent.
 *
 * GitHub answers `GET /git/ref/{ref}` with **404 for a repository the token cannot see**, exactly as
 * it does for a branch that is not there — private repositories are hidden rather than forbidden, so
 * there is no 403 to tell the two apart. Left alone, a token whose installation was revoked, or one
 * scoped to the wrong repository, reads as "that branch does not exist"; `silent_fail` then swallows
 * it and the caller is handed an empty `base_branch` and proceeds to branch from nothing.
 *
 * Asking for the default branch is the cheapest probe that distinguishes them, and it costs a request
 * only on the path that is about to fail anyway. Whatever it throws propagates untouched — it is not
 * a {@link BranchNotFoundError}, which is the only thing `silent_fail` is allowed to silence.
 *
 * Skipped when the branch under test *is* the default branch: resolving it already required this
 * call, so the repository is known to be reachable and a second request would prove nothing.
 */
async function assertRepositoryReachable(
  api: BranchApi,
  coordinates: ReturnType<typeof parseRepository>,
  repository: string,
  origin: BranchOrigin,
): Promise<void> {
  if (origin === 'default-branch') {
    return;
  }

  await api.getDefaultBranch(coordinates);
}

/**
 * Resolves the base branch: the requested branch if given, otherwise the repository's default
 * branch, optionally verified to exist.
 *
 * @throws {BranchNotFoundError} if the resolved branch does not exist and existence was requested.
 */
export async function resolveBaseBranch(api: BranchApi, request: ResolveRequest): Promise<ResolveResult> {
  const coordinates = parseRepository(request.repository);

  const { branch, origin } = await resolveBranchOrDefault(api, coordinates, request.branchName);

  if (!request.checkIfExist) {
    return { branch, exists: undefined, origin };
  }

  // The default branch is verified too: a repository without any commit reports a default branch
  // name that has no ref behind it, and callers must not check that branch out.
  if (!(await api.branchExists(coordinates, branch))) {
    await assertRepositoryReachable(api, coordinates, request.repository, origin);

    throw new BranchNotFoundError(request.repository, branch);
  }

  return { branch, exists: true, origin };
}
