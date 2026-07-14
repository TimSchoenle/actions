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
