import { createOctokit } from './github-client.js';
import { resolveExists, resolveOptional } from './github.js';

import type { RepositoryCoordinates } from './github.js';

/**
 * The git ref operations the branch actions need.
 *
 * A consumer declares the subset it actually uses and accepts this by structural typing, so an
 * action that only reads the default branch is not handed the ability to delete one — and its tests
 * still fake only what it uses.
 */
export interface BranchApi {
  /** Resolves whether the given branch exists. Throws for any error other than "not found". */
  branchExists(repository: RepositoryCoordinates, branch: string): Promise<boolean>;
  /** Points a new `refs/heads/{branch}` at the given commit. */
  createBranch(repository: RepositoryCoordinates, branch: string, sha: string): Promise<void>;
  /** Deletes the given branch. Throws when the deletion is rejected. */
  deleteBranch(repository: RepositoryCoordinates, branch: string): Promise<void>;
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

/** Where a resolved branch came from — useful for logging and for the caller's audit trail. */
export type BranchOrigin = 'default-branch' | 'input';

/** A branch, and whether it was asked for or fell back to the repository's default. */
export interface ResolvedBranch {
  branch: string;
  origin: BranchOrigin;
}

/**
 * Resolves the branch to work from: the requested one, or the repository's default when none was
 * requested.
 *
 * An empty result is rejected rather than passed on: a repository without any commit reports a
 * default branch name that has no ref behind it, and every caller would otherwise turn that into a
 * request against `heads/`, which addresses the ref namespace instead of a branch.
 */
export async function resolveBranchOrDefault(
  api: Pick<BranchApi, 'getDefaultBranch'>,
  repository: RepositoryCoordinates,
  branchName: string,
): Promise<ResolvedBranch> {
  const branch = branchName || (await api.getDefaultBranch(repository));

  if (branch === '') {
    throw new Error(`Unable to resolve a base branch for repository: ${repository.owner}/${repository.repo}`);
  }

  return { branch, origin: branchName ? 'input' : 'default-branch' };
}

/** The Git ref a branch lives behind, e.g. `heads/main` for the branch `main`. */
function branchRef(branch: string): string {
  return `heads/${branch}`;
}

/**
 * Binds the {@link BranchApi} to the GitHub REST API.
 *
 * A branch is read through the exact-match single-ref endpoint (`GET /git/ref/{ref}`). The list
 * endpoint (`GET /git/refs/{ref}`) prefix-matches instead, so it reports `feature` as existing while
 * only `feature-x` does — and a delete or a reset would then hit a branch nobody asked for.
 *
 * Only a missing ref is translated into absence; every other error propagates. See
 * {@link resolveExists}.
 */
export function createBranchApi(token: string): BranchApi {
  const octokit = createOctokit(token);

  return {
    async branchExists({ owner, repo }: RepositoryCoordinates, branch: string): Promise<boolean> {
      return resolveExists(octokit.rest.git.getRef({ owner, ref: branchRef(branch), repo }));
    },

    async createBranch({ owner, repo }: RepositoryCoordinates, branch: string, sha: string): Promise<void> {
      await octokit.rest.git.createRef({ owner, ref: `refs/heads/${branch}`, repo, sha });
    },

    async deleteBranch({ owner, repo }: RepositoryCoordinates, branch: string): Promise<void> {
      await octokit.rest.git.deleteRef({ owner, ref: branchRef(branch), repo });
    },

    async getBranchSha({ owner, repo }: RepositoryCoordinates, branch: string): Promise<string | undefined> {
      const response = await resolveOptional(octokit.rest.git.getRef({ owner, ref: branchRef(branch), repo }));

      return response?.data.object.sha;
    },

    async getDefaultBranch({ owner, repo }: RepositoryCoordinates): Promise<string> {
      const { data } = await octokit.rest.repos.get({ owner, repo });

      return data.default_branch;
    },

    async resetBranch({ owner, repo }: RepositoryCoordinates, branch: string, sha: string): Promise<void> {
      await octokit.rest.git.updateRef({ force: true, owner, ref: branchRef(branch), repo, sha });
    },
  };
}
