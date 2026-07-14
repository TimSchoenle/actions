import { parseRepository } from 'actions-common-ts-util';

import type { RepositoryCoordinates } from 'actions-common-ts-util';

/** The repository operations this action needs, kept minimal so it can be faked in tests. */
export interface BranchApi {
  /** Resolves the default branch of the repository. */
  getDefaultBranch(repository: RepositoryCoordinates): Promise<string>;
  /** Resolves whether the given branch exists. Throws for any error other than "not found". */
  branchExists(repository: RepositoryCoordinates, branch: string): Promise<boolean>;
}

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
  origin: 'default-branch' | 'input';
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
 * Resolves the base branch: the requested branch if given, otherwise the repository's default
 * branch, optionally verified to exist.
 *
 * @throws {BranchNotFoundError} if the resolved branch does not exist and existence was requested.
 */
export async function resolveBaseBranch(api: BranchApi, request: ResolveRequest): Promise<ResolveResult> {
  const coordinates = parseRepository(request.repository);

  const branch = request.branchName || (await api.getDefaultBranch(coordinates));
  const origin = request.branchName ? 'input' : 'default-branch';

  if (branch === '') {
    throw new Error(`Unable to resolve a base branch for repository: ${request.repository}`);
  }

  if (!request.checkIfExist) {
    return { branch, exists: undefined, origin };
  }

  // The default branch is verified too: a repository without any commit reports a default branch
  // name that has no ref behind it, and callers must not check that branch out.
  if (!(await api.branchExists(coordinates, branch))) {
    throw new BranchNotFoundError(request.repository, branch);
  }

  return { branch, exists: true, origin };
}
