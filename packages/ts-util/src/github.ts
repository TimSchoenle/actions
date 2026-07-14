/** A repository split into its owner and name, e.g. `owner/repo`. */
export interface RepositoryCoordinates {
  owner: string;
  repo: string;
}

const REPOSITORY_PATTERN = /^([^\s/]+)\/([^\s/]+)$/;

/**
 * Splits `owner/repo` into its parts.
 *
 * Validated strictly: a malformed value (a bare name, a URL, a trailing path) would otherwise be
 * silently turned into a nonsensical API request whose 404 is indistinguishable from a genuinely
 * missing repository.
 */
export function parseRepository(repository: string): RepositoryCoordinates {
  const match = REPOSITORY_PATTERN.exec(repository);

  if (!match) {
    throw new Error(`Invalid repository '${repository}'. Expected the format 'owner/repo'.`);
  }

  return { owner: match[1], repo: match[2] };
}

/** Narrows an unknown error to an Octokit HTTP error carrying the given status. */
export function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' && error !== null && 'status' in error && (error as { status: unknown }).status === status
  );
}

/** GitHub's answer for a resource that does not exist, or that the token may not see. */
const NOT_FOUND = 404;

/**
 * Resolves whether a request found its resource.
 *
 * Only a 404 becomes `false`. Every other failure — bad credentials, a rate limit, a server error —
 * propagates, because each caller of this treats "does not exist" as a benign, expected outcome:
 * a branch that is already gone, a pull request that was never opened. Reporting a broken token as
 * absence would turn a workflow that silently changed nothing into a green check.
 *
 * Written once so that the `catch` cannot be widened by accident in one adapter and not the others.
 */
export async function resolveExists(request: Promise<unknown>): Promise<boolean> {
  try {
    await request;
    return true;
  } catch (error) {
    if (hasStatus(error, NOT_FOUND)) {
      return false;
    }
    throw error;
  }
}

/**
 * Resolves a request's response, or `undefined` when the resource does not exist.
 *
 * Only a 404 becomes `undefined`; see {@link resolveExists} for why nothing else may.
 */
export async function resolveOptional<T>(request: Promise<T>): Promise<T | undefined> {
  try {
    return await request;
  } catch (error) {
    if (hasStatus(error, NOT_FOUND)) {
      return undefined;
    }
    throw error;
  }
}
