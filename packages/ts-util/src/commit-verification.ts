/**
 * A commit reduced to what an author, committer and signature check needs.
 *
 * The git author and committer are free text that anyone can write into a commit, and GitHub links
 * each to an account by its email address alone. Only the signature binds a commit to a key holder, so
 * the record carries who signed it alongside who it claims to be from.
 */
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
  /** Database ID of the account the committer email resolves to; `null` when it resolves to none. */
  committerId: number | null;
  /** True when GitHub reports the commit signature as valid. */
  signatureValid: boolean;
  /** GitHub's signature state (e.g. `VALID`, `UNSIGNED`), used for diagnostics only. */
  signatureState: string | null;
  /**
   * Database ID of the account that owns the signing key; `null` for an unsigned commit or a key that
   * resolves to no account.
   */
  signerId: number | null;
  /**
   * True when GitHub itself signed the commit, which it does only for a commit it created on behalf of
   * the authenticated caller (web edits, the contents API, `createCommitOnBranch`).
   */
  signedByGitHub: boolean;
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

/** Reasons the author list fails: missing, unlinked or outside the accepted set. */
function authorReasons(commit: CommitRecord, acceptedIds: ReadonlySet<number>): string[] {
  if (commit.authorIds.length === 0) {
    return ['commit has no authors'];
  }

  const reasons: string[] = [];
  const unknown = commit.authorIds.filter((id) => id === null).length;
  const rejected = commit.authorIds.filter((id) => id !== null && !acceptedIds.has(id));

  if (unknown > 0) {
    reasons.push(`${unknown} author(s) are not linked to a GitHub account`);
  }
  if (rejected.length > 0) {
    reasons.push(`author(s) not accepted: ${rejected.join(', ')}`);
  }

  return reasons;
}

/**
 * Reasons the committer fails. A commit GitHub signed names GitHub's own `web-flow` account as its
 * committer, so the accepted set is not required of it there; it must still resolve to an account.
 */
function committerReasons(commit: CommitRecord, acceptedIds: ReadonlySet<number>): string[] {
  if (commit.committerId === null) {
    return ['committer is not linked to a GitHub account'];
  }
  if (!commit.signedByGitHub && !acceptedIds.has(commit.committerId)) {
    return [`committer not accepted: ${commit.committerId}`];
  }

  return [];
}

/**
 * Reasons the signature fails: it must be valid, and made either by GitHub or with a key owned by an
 * accepted account. A valid signature proves only that its key holder made the commit, not that the
 * author named in it did.
 */
function signatureReasons(commit: CommitRecord, acceptedIds: ReadonlySet<number>): string[] {
  if (!commit.signatureValid) {
    return [`signature is not valid (state: ${commit.signatureState ?? 'UNSIGNED'})`];
  }
  if (commit.signedByGitHub) {
    return [];
  }
  if (commit.signerId === null) {
    return ['signing key is not linked to a GitHub account'];
  }
  if (!acceptedIds.has(commit.signerId)) {
    return [`signer not accepted: ${commit.signerId}`];
  }

  return [];
}

/**
 * Validates a single commit against the accepted accounts.
 *
 * Every author and the committer must be accepted, and the signature must be valid and made either by
 * GitHub or with a key owned by an accepted account. The author and committer are only what the commit
 * claims: GitHub reports a commit that names an accepted author but carries someone else's valid
 * signature as `VALID`, and only the signer check rejects it.
 */
export function validateCommit(commit: CommitRecord, acceptedIds: ReadonlySet<number>): CommitFailure | undefined {
  const reasons = [
    ...authorReasons(commit, acceptedIds),
    ...committerReasons(commit, acceptedIds),
    ...signatureReasons(commit, acceptedIds),
  ];

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
