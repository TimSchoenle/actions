/** A pull request addressed by its repository and number. */
export interface PullRequestCoordinates {
  owner: string;
  repo: string;
  number: number;
}

/**
 * Matches the `.../owner/repo/pull/123` tail of a pull request URL, ignoring the host in front and
 * any `/files`, `?query` or `#fragment` after the number — mirroring the host-agnostic extraction the
 * composite version did with `sed`.
 */
const PULL_REQUEST_URL_PATTERN = /\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/;

/**
 * Extracts the repository and number a pull request URL points at.
 *
 * Rejecting a URL it cannot parse — rather than approving against a repository or number guessed from
 * a partial match — is what keeps this safe to drive auto-approval: the target of the approval must be
 * exactly the pull request the caller named.
 *
 * @throws if the URL does not contain an `owner/repo/pull/<number>` segment.
 */
export function parsePullRequestUrl(url: string): PullRequestCoordinates {
  const match = PULL_REQUEST_URL_PATTERN.exec(url.trim());

  if (!match) {
    throw new Error(`Invalid pull request URL '${url}'. Expected a URL like 'https://github.com/owner/repo/pull/123'.`);
  }

  return { number: Number(match[3]), owner: match[1], repo: match[2] };
}
