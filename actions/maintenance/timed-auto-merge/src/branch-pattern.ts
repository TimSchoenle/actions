import { compileBranchPattern, errorMessage, PATTERN_MATCH_TIMEOUT_MS, testPatterns } from 'actions-util';

/** How `branch_pattern` is read. */
export type PatternMode = 'legacy' | 'regex';

const PATTERN_MODES: readonly PatternMode[] = ['legacy', 'regex'];

/** @throws if the value is not one of the supported modes. */
export function parsePatternMode(value: string): PatternMode {
  if (!(PATTERN_MODES as readonly string[]).includes(value)) {
    throw new Error(`Invalid 'pattern_mode' ${JSON.stringify(value)}. Expected one of: ${PATTERN_MODES.join(', ')}.`);
  }

  return value as PatternMode;
}

/**
 * Turns `branch_pattern` into the POSIX extended regular expression that is actually matched.
 *
 * `legacy` keeps the syntax of the reusable workflow this action replaces, which built
 * `^${pattern//%/.*}` and passed it to jq's `test`. Every `%` becomes `.*`, so a literal `%` cannot
 * be written in this mode. The pattern is wrapped in a group before it is anchored: the workflow
 * anchored only the first alternative of `a|b`, which let `b` match anywhere in the branch name.
 *
 * `regex` passes the pattern through unchanged, unanchored, the way `auto-approve-pr` and
 * `verify-branch-name` read theirs.
 */
export function toBranchRegex(pattern: string, mode: PatternMode): string {
  return mode === 'legacy' ? `^(?:${pattern.replaceAll('%', '.*')})` : pattern;
}

/** A compiled branch matcher that evaluates many branch names under one time budget. */
export interface BranchMatcher {
  /** The expression the input was translated to, for the log. */
  source: string;
  /**
   * Returns, for each branch name, whether it matches.
   *
   * @throws if evaluating the batch exceeds the time budget, which names the pattern.
   */
  matchAll(branchNames: readonly string[]): boolean[];
}

/**
 * Compiles `branch_pattern` once, so every open pull request is matched against the same RegExp.
 *
 * Branch names are attacker-influenced: anyone who can push a branch can name it to trigger
 * catastrophic backtracking in a careless pattern. The whole batch therefore runs under the shared
 * budget of `testPatterns`, and an exhausted budget fails the step instead of hanging the runner.
 *
 * @throws if the pattern is empty or not a valid regular expression.
 */
export function createBranchMatcher(
  pattern: string,
  mode: PatternMode,
  timeoutMs: number = PATTERN_MATCH_TIMEOUT_MS,
): BranchMatcher {
  if (pattern === '') {
    throw new Error("'branch_pattern' must not be empty; it would match every open pull request.");
  }

  const source = toBranchRegex(pattern, mode);
  const regex = compileBranchPattern(source);

  return {
    matchAll(branchNames) {
      try {
        return testPatterns(regex, branchNames, timeoutMs);
      } catch (error) {
        throw new Error(
          `Branch pattern ${JSON.stringify(source)} could not be evaluated against ${branchNames.length} branch ` +
            `name(s) within ${timeoutMs}ms (possible catastrophic backtracking): ${errorMessage(error)}`,
          { cause: error },
        );
      }
    },
    source,
  };
}
