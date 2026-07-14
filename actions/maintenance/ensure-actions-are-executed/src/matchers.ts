import { compilePosixRegex, errorMessage, PATTERN_MATCH_TIMEOUT_MS, testPattern } from 'actions-util';

import type { CheckRun } from './checks.js';

/** How a configured matcher is interpreted. `auto` decides per matcher; the others force one. */
export type MatchMode = 'auto' | 'exact' | 'regex';

/** The modes a matcher can end up in once `auto` has been resolved. */
export type ResolvedMatchMode = Exclude<MatchMode, 'auto'>;

const MATCH_MODES: readonly MatchMode[] = ['auto', 'exact', 'regex'];

/** A matcher wrapped in slashes, e.g. `/^build .*$/`, which `auto` reads as a regex. */
const SLASH_WRAPPED_REGEX = /^\/(.+)\/$/s;

/** A configured matcher, with its mode resolved and its pattern compiled. */
export interface Matcher {
  /** The matcher exactly as configured, including any wrapping slashes. Used for logging. */
  raw: string;
  mode: ResolvedMatchMode;
  /** The compiled pattern. `undefined` for an exact matcher, which needs no regex. */
  regex: RegExp | undefined;
}

/** The checks a single matcher selected. */
export interface MatcherOutcome {
  matcher: Matcher;
  matchedNames: string[];
}

export interface Selection {
  /** One entry per configured matcher, in configuration order, for logging and diagnostics. */
  outcomes: MatcherOutcome[];
  /** The checks selected by at least one matcher, deduplicated by name and ordered by name. */
  selected: CheckRun[];
}

/** Raised when `checks` contains nothing to match with — a workflow that verifies nothing. */
export class NoMatchersError extends Error {
  constructor() {
    super("No checks configured. Provide at least one matcher in 'checks'.");
    this.name = 'NoMatchersError';
  }
}

/** Raised when a matcher is used as a regex but cannot be compiled. */
export class InvalidMatcherError extends Error {
  constructor(
    readonly matcher: string,
    readonly reason: string,
  ) {
    super(`Invalid regex matcher '${matcher}': ${reason}`);
    this.name = 'InvalidMatcherError';
  }
}

/**
 * Raised when a matcher compiles but cannot be evaluated within its time budget.
 *
 * Fails the step rather than reporting the check as unmatched: a matcher that never finishes says
 * nothing about whether the check passed, and "unmatched" is read as "not started", which passes.
 */
export class MatcherEvaluationError extends Error {
  constructor(
    readonly matcher: string,
    readonly checkName: string,
    readonly reason: string,
  ) {
    super(
      `Matcher '${matcher}' could not be evaluated against check '${checkName}' within ${PATTERN_MATCH_TIMEOUT_MS}ms ` +
        `(possible catastrophic backtracking): ${reason}`,
    );
    this.name = 'MatcherEvaluationError';
  }
}

/**
 * Normalizes the requested match mode.
 *
 * Case is folded because the value is typed by hand into a workflow file, where `Regex` is a typo, not
 * a different mode.
 *
 * @throws if the mode is not one of `auto`, `exact` or `regex`.
 */
export function parseMatchMode(value: string): MatchMode {
  const mode = value.trim().toLowerCase();

  if (!MATCH_MODES.includes(mode as MatchMode)) {
    throw new Error(`Invalid match_mode '${value}'. Allowed values: ${MATCH_MODES.join(', ')}.`);
  }

  return mode as MatchMode;
}

/**
 * Splits the `checks` input into matchers.
 *
 * Both newlines and commas separate matchers, so the same input works as a YAML block scalar and as a
 * one-line comma-separated list. A comma therefore cannot appear inside a matcher — a regex needing
 * one has to be split into two matchers, exactly as with the shell predecessor.
 *
 * @throws {NoMatchersError} if nothing but whitespace and separators was configured.
 */
export function normalizeMatchers(checks: string): string[] {
  const matchers = checks
    .split(/[\n,]/)
    .map((matcher) => matcher.trim())
    .filter((matcher) => matcher !== '');

  if (matchers.length === 0) {
    throw new NoMatchersError();
  }

  return matchers;
}

/**
 * Resolves a raw matcher into the mode it is evaluated in and compiles its pattern.
 *
 * In `auto`, slashes make the regex intent explicit (`/^lint/`) and are stripped before compiling;
 * everything else is compared literally, so a check named `build (18.x)` needs no escaping.
 *
 * @throws {InvalidMatcherError} if a regex matcher does not compile. Silently downgrading it to an
 * exact match would let a typo'd pattern match nothing and pass as "not started".
 */
export function resolveMatcher(raw: string, mode: MatchMode): Matcher {
  const wrapped = mode === 'auto' ? SLASH_WRAPPED_REGEX.exec(raw) : undefined;

  if (mode === 'exact' || (mode === 'auto' && !wrapped)) {
    return { mode: 'exact', raw, regex: undefined };
  }

  const pattern = wrapped ? wrapped[1] : raw;

  try {
    return { mode: 'regex', raw, regex: compilePosixRegex(pattern) };
  } catch (error) {
    throw new InvalidMatcherError(raw, errorMessage(error));
  }
}

/**
 * Tests a check name against a matcher.
 *
 * Regex matching is unanchored, mirroring bash's `[[ $name =~ $pattern ]]`: `lint` selects
 * `lint (18.x)` as well as `pre-lint`. Anchor with `^` and `$` to opt out.
 *
 * Dialect note: the shell predecessor evaluated POSIX extended regular expressions, this runs
 * JavaScript's RegExp. `compilePosixRegex` reconciles the two, so matchers written for the shell keep
 * working; the residual divergence is documented there.
 *
 * Evaluation is time-boxed: a check name is whatever the workflow that produced it chose to call it,
 * and a matcher pushed into catastrophic backtracking would otherwise hang the job indefinitely.
 *
 * @throws {MatcherEvaluationError} if the matcher exceeds its evaluation budget.
 */
export function matchesCheckName(matcher: Matcher, checkName: string): boolean {
  if (matcher.regex === undefined) {
    return checkName === matcher.raw;
  }

  try {
    return testPattern(matcher.regex, checkName);
  } catch (error) {
    throw new MatcherEvaluationError(matcher.raw, checkName, errorMessage(error));
  }
}

/**
 * Selects the checks the matchers point at.
 *
 * A matcher that selects nothing is reported, not rejected: a check that never started produces no
 * check run, and "not started" is the condition this action exists to tolerate — it only verifies
 * checks that did start.
 */
export function selectChecks(checkRuns: CheckRun[], matchers: Matcher[]): Selection {
  const selectedByName = new Map<string, CheckRun>();
  const outcomes: MatcherOutcome[] = [];

  for (const matcher of matchers) {
    const matched = checkRuns.filter((checkRun) => matchesCheckName(matcher, checkRun.name));

    for (const checkRun of matched) {
      selectedByName.set(checkRun.name, checkRun);
    }

    outcomes.push({ matchedNames: matched.map((checkRun) => checkRun.name), matcher });
  }

  return {
    outcomes,
    selected: [...selectedByName.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}
