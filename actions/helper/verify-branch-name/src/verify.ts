import { runInNewContext } from 'node:vm';

/**
 * Upper bound for a single branch-pattern evaluation.
 *
 * Branch names on a pull request are attacker-controlled (a fork can name its branch anything), so a
 * poorly written pattern could be pushed into catastrophic backtracking. The match therefore runs
 * inside a V8 context that is terminated once the budget is exhausted.
 */
export const PATTERN_MATCH_TIMEOUT_MS = 1000;

/**
 * POSIX bracket expression classes, translated to their JavaScript character-range equivalents.
 *
 * The predecessor of this action matched branches with bash `[[ ... =~ ... ]]`, i.e. POSIX extended
 * regular expressions, which support `[[:alpha:]]`-style classes that JavaScript's RegExp does not.
 * Translating them keeps previously working patterns working.
 */
const POSIX_CLASSES = new Map<string, string>([
  ['alnum', 'A-Za-z0-9'],
  ['alpha', 'A-Za-z'],
  ['blank', ' \\t'],
  ['cntrl', '\\x00-\\x1f\\x7f'],
  ['digit', '0-9'],
  ['graph', '\\x21-\\x7e'],
  ['lower', 'a-z'],
  ['print', '\\x20-\\x7e'],
  ['punct', '!-\\/:-@\\[-`{-~'],
  ['space', '\\s'],
  ['upper', 'A-Z'],
  ['word', 'A-Za-z0-9_'],
  ['xdigit', '0-9A-Fa-f'],
]);

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
 * Rewrites POSIX bracket expression classes (`[[:digit:]]`) into JavaScript character ranges.
 *
 * Only occurrences inside a bracket expression are rewritten; outside of one, `[:digit:]` is an
 * ordinary character class in both dialects and must be left untouched.
 */
/** A POSIX class found in a bracket expression, and where it ends. */
interface PosixClassMatch {
  /** The JavaScript character range the class translates to. */
  text: string;
  /** Index of the first character after the class. */
  nextIndex: number;
}

/** Reads a `[:class:]` token at `index`, or returns undefined if there is none. */
function readPosixClass(pattern: string, index: number): PosixClassMatch | undefined {
  if (pattern[index] !== '[' || pattern[index + 1] !== ':') {
    return undefined;
  }

  const closingIndex = pattern.indexOf(':]', index + 2);

  if (closingIndex === -1) {
    return undefined;
  }

  const text = POSIX_CLASSES.get(pattern.slice(index + 2, closingIndex));

  return text === undefined ? undefined : { nextIndex: closingIndex + 2, text };
}

export function translatePosixClasses(pattern: string): string {
  let result = '';
  let index = 0;
  let insideBracket = false;

  while (index < pattern.length) {
    const character = pattern[index];

    if (character === '\\' && index + 1 < pattern.length) {
      result += character + pattern[index + 1];
      index += 2;
      continue;
    }

    const posixClass = insideBracket ? readPosixClass(pattern, index) : undefined;

    if (posixClass) {
      result += posixClass.text;
      index = posixClass.nextIndex;
      continue;
    }

    if (character === '[' && !insideBracket) {
      insideBracket = true;
    } else if (character === ']' && insideBracket) {
      insideBracket = false;
    }

    result += character;
    index += 1;
  }

  return result;
}

/**
 * Compiles a branch pattern into a RegExp, mirroring the unanchored, case-sensitive semantics of
 * bash's `[[ $branch =~ $pattern ]]`.
 */
export function compileBranchPattern(pattern: string): RegExp {
  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- the pattern is the action's purpose; evaluation is time-boxed in matchesBranchPattern
    return new RegExp(translatePosixClasses(pattern));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid branch pattern '${pattern}': ${reason}`, { cause: error });
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
    return runInNewContext('regex.test(branchName)', { branchName, regex }, { timeout: timeoutMs }) === true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Branch pattern '${pattern}' could not be evaluated against '${branchName}' within ${timeoutMs}ms ` +
        `(possible catastrophic backtracking): ${reason}`,
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
