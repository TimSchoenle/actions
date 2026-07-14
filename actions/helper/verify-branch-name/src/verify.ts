import { compilePosixRegex, errorMessage, PATTERN_MATCH_TIMEOUT_MS, testPattern } from 'actions-util';

export interface BranchVerificationRequest {
  /** POSIX-ERE-compatible pattern the head branch must match. An empty pattern skips the check. */
  branchPattern: string;
  /** Head branch name of the pull request, e.g. `feature/my-branch`. */
  headRef: string;
  /** Full name of the head repository, e.g. `owner/repo`. */
  headRepoFullName: string;
  /** Full name of the base repository, e.g. `owner/repo`. */
  baseRepoFullName: string;
  /** Whether a pull request opened from a fork must be rejected. */
  rejectForks: boolean;
}

export interface BranchVerificationResult {
  /** True when every enabled check passed. */
  verified: boolean;
  /** True when the head branch matched the pattern (or no pattern was given). */
  branchPatternVerified: boolean;
  /** True when the pull request is not a fork, or forks are allowed. */
  forkVerified: boolean;
  /** True when head and base repository differ. */
  isFork: boolean;
}

/**
 * Compiles a branch pattern into a RegExp, mirroring the unanchored, case-sensitive semantics of
 * bash's `[[ $branch =~ $pattern ]]`.
 */
export function compileBranchPattern(pattern: string): RegExp {
  try {
    return compilePosixRegex(pattern);
  } catch (error) {
    throw new Error(`Invalid branch pattern '${pattern}': ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * Tests a branch name against a pattern under a hard time budget.
 *
 * @throws if the pattern is invalid or its evaluation exceeds {@link PATTERN_MATCH_TIMEOUT_MS}.
 */
export function matchesBranchPattern(
  pattern: string,
  branchName: string,
  timeoutMs: number = PATTERN_MATCH_TIMEOUT_MS,
): boolean {
  const regex = compileBranchPattern(pattern);

  try {
    return testPattern(regex, branchName, timeoutMs);
  } catch (error) {
    throw new Error(
      `Branch pattern '${pattern}' could not be evaluated against '${branchName}' within ${timeoutMs}ms ` +
        `(possible catastrophic backtracking): ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

/**
 * Validates the request before any check runs, so a misconfigured workflow fails loudly instead of
 * silently reporting an unverified pull request.
 */
function validateRequest(request: BranchVerificationRequest): void {
  if (request.branchPattern !== '' && request.headRef === '') {
    throw new Error('Branch name (head_ref) not provided. Cannot verify branch pattern.');
  }

  if (request.headRepoFullName === '' || request.baseRepoFullName === '') {
    throw new Error(
      'Repository names not provided. Cannot verify fork status. ' +
        `head_repo_full_name: '${request.headRepoFullName}', base_repo_full_name: '${request.baseRepoFullName}'.`,
    );
  }
}

/**
 * Verifies that the head branch matches the configured pattern and that the pull request does not
 * originate from a fork when forks are rejected.
 */
export function verifyBranch(request: BranchVerificationRequest): BranchVerificationResult {
  validateRequest(request);

  const branchPatternVerified =
    request.branchPattern === '' ? true : matchesBranchPattern(request.branchPattern, request.headRef);

  const isFork = request.headRepoFullName !== request.baseRepoFullName;
  const forkVerified = !(isFork && request.rejectForks);

  return {
    branchPatternVerified,
    forkVerified,
    isFork,
    verified: branchPatternVerified && forkVerified,
  };
}
