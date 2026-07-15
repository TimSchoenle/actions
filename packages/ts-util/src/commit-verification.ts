/** A commit reduced to what an author/signature check needs. */
export interface CommitRecord {
  /** Full commit SHA. */
  oid: string;
  /**
   * Database IDs of every author of the commit; `null` for an author without a linked GitHub account.
   *
   * Every author is present: the fetch pages the author connection to completion and rejects a commit
   * whose authors it cannot fully retrieve, so a short list here means "few authors", never "the rest
   * were not fetched".
   */
  authorIds: readonly (number | null)[];
  /** True when GitHub reports the commit signature as valid. */
  signatureValid: boolean;
  /** GitHub's signature state (e.g. `VALID`, `UNSIGNED`), used for diagnostics only. */
  signatureState: string | null;
}

/** A commit that failed verification, with every reason it failed. */
export interface CommitFailure {
  oid: string;
  reasons: string[];
}

export interface VerificationResult {
  /** True only if every commit was checked and every check passed. */
  verified: boolean;
  /** SHAs of all commits that failed verification. */
  invalidCommits: string[];
  /** Per-commit failure details, in commit order. */
  failures: CommitFailure[];
}

/**
 * Parses the comma-separated `user_ids` input into GitHub user database IDs.
 *
 * Every entry must be a positive integer. A typo would otherwise be coerced to `NaN`, silently match
 * nothing and report the pull request as unverified — indistinguishable from a genuine rejection.
 */
export function parseUserIds(input: string): number[] {
  const entries = input
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  if (entries.length === 0) {
    throw new Error("No accepted user IDs provided. 'user_ids' must contain at least one user database ID.");
  }

  const ids = entries.map((entry) => {
    if (!/^\d+$/.test(entry) || !Number.isSafeInteger(Number(entry)) || Number(entry) === 0) {
      throw new Error(`Invalid user ID '${entry}'. Expected a positive integer GitHub user database ID.`);
    }

    return Number(entry);
  });

  return [...new Set(ids)];
}

/**
 * Validates a single commit: every author must be an accepted user, and the signature must be valid.
 */
export function validateCommit(commit: CommitRecord, acceptedIds: ReadonlySet<number>): CommitFailure | undefined {
  const reasons: string[] = [];

  if (commit.authorIds.length === 0) {
    reasons.push('commit has no authors');
  } else {
    const unknown = commit.authorIds.filter((id) => id === null).length;
    const rejected = commit.authorIds.filter((id) => id !== null && !acceptedIds.has(id));

    if (unknown > 0) {
      reasons.push(`${unknown} author(s) are not linked to a GitHub account`);
    }
    if (rejected.length > 0) {
      reasons.push(`author(s) not accepted: ${rejected.join(', ')}`);
    }
  }

  if (!commit.signatureValid) {
    reasons.push(`signature is not valid (state: ${commit.signatureState ?? 'UNSIGNED'})`);
  }

  return reasons.length > 0 ? { oid: commit.oid, reasons } : undefined;
}

/**
 * Verifies every commit of a pull request.
 *
 * An empty commit list is never verified: it means the data needed for the decision is missing, and
 * this check exists to gate automation such as auto-approval.
 */
export function verifyCommits(commits: readonly CommitRecord[], acceptedIds: readonly number[]): VerificationResult {
  const accepted = new Set(acceptedIds);
  const failures: CommitFailure[] = [];

  for (const commit of commits) {
    const failure = validateCommit(commit, accepted);

    if (failure) {
      failures.push(failure);
    }
  }

  return {
    failures,
    invalidCommits: failures.map((failure) => failure.oid),
    verified: commits.length > 0 && failures.length === 0,
  };
}
