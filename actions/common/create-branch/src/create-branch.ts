import { parseRepository } from 'actions-common-ts-util';

import type { RepositoryCoordinates } from 'actions-common-ts-util';

/** The git ref operations this action needs, kept minimal so it can be faked in tests. */
export interface BranchApi {
  /** Points a new `refs/heads/{branch}` at the given commit. */
  createBranch(repository: RepositoryCoordinates, branch: string, sha: string): Promise<void>;
  /**
   * Resolves the commit a branch points at, or `undefined` when the branch does not exist. Throws
   * for any error other than "not found".
   */
  getBranchSha(repository: RepositoryCoordinates, branch: string): Promise<string | undefined>;
  /** Resolves the default branch of the repository. */
  getDefaultBranch(repository: RepositoryCoordinates): Promise<string>;
  /** Force-moves an existing branch to the given commit, discarding whatever it pointed at. */
  resetBranch(repository: RepositoryCoordinates, branch: string, sha: string): Promise<void>;
}

/** Where the base branch came from — useful for logging and for the caller's audit trail. */
export type BaseBranchOrigin = 'default-branch' | 'input';

/** What happened to the target branch. Anything but `unchanged` moved it to the base commit. */
export type BranchOutcome = 'created' | 'reset' | 'unchanged';

export interface CreateBranchRequest {
  /** Repository to create the branch in, e.g. `owner/repo`. */
  repository: string;
  /** Branch to create, or to reset when it already exists and `resetBranch` is set. */
  branchName: string;
  /** Branch to branch from. Empty resolves the repository's default branch. */
  baseBranch: string;
  /** Whether an already existing target branch is force-moved back onto the base branch. */
  resetBranch: boolean;
}

export interface CreateBranchResult {
  /** The target branch. */
  branch: string;
  /** The resolved base branch, which is the default branch when none was requested. */
  baseBranch: string;
  baseOrigin: BaseBranchOrigin;
  /** Head commit of the base branch. */
  baseSha: string;
  /** Head commit of the target branch after this run. */
  sha: string;
  outcome: BranchOutcome;
}

/**
 * Raised when the base branch carries no commit to branch from: it does not exist, or the
 * repository has no commits at all.
 *
 * Distinct from transport or authorization failures, which must never be silenced — a token that
 * cannot read the repository would otherwise be indistinguishable from a missing base branch.
 */
export class BaseBranchNotFoundError extends Error {
  constructor(
    readonly repository: string,
    readonly branch: string,
  ) {
    super(`Could not find SHA for base branch '${branch}' in repository: ${repository}`);
    this.name = 'BaseBranchNotFoundError';
  }
}

/** Resolves the branch to base the target branch on, and the commit at its head. */
async function resolveBase(
  api: BranchApi,
  coordinates: RepositoryCoordinates,
  request: CreateBranchRequest,
): Promise<{ baseBranch: string; baseOrigin: BaseBranchOrigin; baseSha: string }> {
  const baseBranch = request.baseBranch || (await api.getDefaultBranch(coordinates));
  const baseOrigin: BaseBranchOrigin = request.baseBranch ? 'input' : 'default-branch';

  if (baseBranch === '') {
    throw new Error(`Unable to resolve a base branch for repository: ${request.repository}`);
  }

  const baseSha = await api.getBranchSha(coordinates, baseBranch);

  // An empty SHA is treated like a missing branch: creating a ref at an empty commit would be
  // rejected by the API with an error that says nothing about which branch was at fault.
  if (baseSha === undefined || baseSha === '') {
    throw new BaseBranchNotFoundError(request.repository, baseBranch);
  }

  return { baseBranch, baseOrigin, baseSha };
}

/**
 * Creates the target branch at the head of the base branch, or — when it already exists — resets it
 * there if the caller asked for it, and otherwise leaves it alone.
 *
 * Resetting is force-moving a ref, so it is opt-in: an existing branch is only rewound when
 * `resetBranch` is set, and its own head commit is reported back unchanged otherwise.
 *
 * @throws {BaseBranchNotFoundError} if the base branch has no commit to branch from.
 */
export async function createOrResetBranch(api: BranchApi, request: CreateBranchRequest): Promise<CreateBranchResult> {
  const coordinates = parseRepository(request.repository);

  if (request.branchName === '') {
    throw new Error('No branch name given. A branch to create or reset is required.');
  }

  const base = await resolveBase(api, coordinates, request);
  const existingSha = await api.getBranchSha(coordinates, request.branchName);
  const target = { ...base, branch: request.branchName };

  if (existingSha === undefined || existingSha === '') {
    await api.createBranch(coordinates, request.branchName, base.baseSha);
    return { ...target, outcome: 'created', sha: base.baseSha };
  }

  if (!request.resetBranch) {
    return { ...target, outcome: 'unchanged', sha: existingSha };
  }

  await api.resetBranch(coordinates, request.branchName, base.baseSha);
  return { ...target, outcome: 'reset', sha: base.baseSha };
}
