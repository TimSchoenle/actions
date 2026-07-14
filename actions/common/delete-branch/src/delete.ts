/** A repository split into its owner and name, e.g. `owner/repo`. */
export interface RepositoryCoordinates {
  owner: string;
  repo: string;
}

/** The repository operations this action needs, kept minimal so it can be faked in tests. */
export interface BranchApi {
  /** Resolves whether the given branch exists. Throws for any error other than "not found". */
  branchExists(repository: RepositoryCoordinates, branch: string): Promise<boolean>;
  /** Deletes the given branch. Throws when the deletion is rejected. */
  deleteBranch(repository: RepositoryCoordinates, branch: string): Promise<void>;
}

export interface DeleteRequest {
  /** Repository to delete the branch from, e.g. `owner/repo`. */
  repository: string;
  /** Branch to delete. */
  branchName: string;
}

/**
 * The outcome of a deletion attempt.
 *
 * A missing branch and a rejected deletion are outcomes rather than errors: this action is
 * deliberately forgiving, so neither of them fails the step. Modelling them in the return type —
 * instead of as exceptions the caller has to remember to catch — keeps that contract visible in the
 * signature and leaves thrown errors to mean exactly one thing: the step must fail.
 */
export type DeleteResult =
  /** The branch existed and is now gone. */
  | { deleted: true; outcome: 'deleted' }
  /** The branch was not there to begin with; nothing was changed. */
  | { deleted: false; outcome: 'not-found' }
  /** The branch exists but could not be deleted, e.g. because it is protected. */
  | { deleted: false; outcome: 'delete-failed'; cause: Error };

const REPOSITORY_PATTERN = /^([^\s/]+)\/([^\s/]+)$/;

/**
 * Splits `owner/repo` into its parts.
 *
 * Validated strictly: a malformed value (a bare name, a URL, a trailing path) would otherwise be
 * silently turned into a nonsensical API request whose 404 is indistinguishable from a genuinely
 * missing repository — and this action reports a missing branch as success, so the mistake would
 * never surface.
 */
export function parseRepository(repository: string): RepositoryCoordinates {
  const match = REPOSITORY_PATTERN.exec(repository);

  if (!match) {
    throw new Error(`Invalid repository '${repository}'. Expected the format 'owner/repo'.`);
  }

  return { owner: match[1], repo: match[2] };
}

/** Preserves the failure that the API reported, without assuming it threw an `Error`. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Deletes the branch if it exists, reporting rather than raising the two expected non-deletions.
 *
 * The existence probe runs first so that an absent branch stays quiet instead of producing a failed
 * `DELETE` and the error noise that comes with it. Only "not found" is treated as absence — an
 * authentication, permission or transport failure propagates, because reporting a broken token as
 * "the branch is not there" would hide real breakage behind a successful step.
 *
 * A rejected deletion, by contrast, is reported as {@link DeleteResult} rather than thrown: callers
 * use this action for cleanup after a merge, where a branch that survives (a protection rule, a lost
 * race with another job) is worth a warning but must not fail a workflow that has already done its
 * work.
 *
 * @throws {Error} if the repository or branch name is malformed, or if the existence probe fails.
 */
export async function deleteBranchIfExists(api: BranchApi, request: DeleteRequest): Promise<DeleteResult> {
  const coordinates = parseRepository(request.repository);

  // An empty name would target the `heads/` ref prefix rather than a branch, so it is rejected
  // instead of being sent to the API.
  if (request.branchName === '') {
    throw new Error(`Invalid branch name ''. Expected the name of the branch to delete.`);
  }

  if (!(await api.branchExists(coordinates, request.branchName))) {
    return { deleted: false, outcome: 'not-found' };
  }

  try {
    await api.deleteBranch(coordinates, request.branchName);
  } catch (error) {
    return { cause: toError(error), deleted: false, outcome: 'delete-failed' };
  }

  return { deleted: true, outcome: 'deleted' };
}
