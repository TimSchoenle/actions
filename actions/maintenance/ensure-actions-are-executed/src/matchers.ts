import type { CheckRun } from './checks.js';

/** How a configured matcher is interpreted. `auto` decides per matcher; the others force one. */
export type MatchMode = 'auto' | 'exact' | 'regex';

/** The modes a matcher can end up in once `auto` has been resolved. */
export type ResolvedMatchMode = Exclude<MatchMode, 'auto'>;

const MATCH_MODES: readonly MatchMode[] = ['auto', 'exact', 'regex'];

/** A matcher wrapped in slashes, e.g. `/^build .*$/`, which `auto` reads as a regex. */
const SLASH_WRAPPED_REGEX = /^\/(.+)\/$/s;

/** A configured matcher, with its mode resolved and its pattern compiled. */
/**
 * POSIX bracket expression classes, translated to their JavaScript character-range equivalents.
 *
 * The shell predecessor evaluated matchers with bash `[[ ... =~ ... ]]`, i.e. POSIX extended regular
 * expressions, which support `[[:digit:]]`-style classes that JavaScript's RegExp does not.
 * Translating them keeps previously working matchers working — an untranslated class compiles to a
 * regex that matches nothing, and a matcher that matches nothing is reported as "not started" and
 * passes, so the failure would be silent.
 *
 * Kept in step with the identical table in `actions/helper/verify-branch-name`.
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

/**
 * Rewrites POSIX bracket expression classes (`[[:digit:]]`) into JavaScript character ranges.
 *
 * Only occurrences inside a bracket expression are rewritten; outside of one, `[:digit:]` is an
 * ordinary character class in both dialects and must be left untouched.
 */
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
    // eslint-disable-next-line security/detect-non-literal-regexp -- matching check names against a caller-supplied pattern is this action's purpose
    return { mode: 'regex', raw, regex: new RegExp(translatePosixClasses(pattern)) };
  } catch (error) {
    throw new InvalidMatcherError(raw, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Tests a check name against a matcher.
 *
 * Regex matching is unanchored, mirroring bash's `[[ $name =~ $pattern ]]`: `lint` selects
 * `lint (18.x)` as well as `pre-lint`. Anchor with `^` and `$` to opt out.
 *
 * Dialect note: the shell predecessor evaluated POSIX extended regular expressions, this runs
 * JavaScript's RegExp. Ordinary patterns behave identically, and POSIX bracket classes
 * (`[[:digit:]]`) are translated by {@link translatePosixClasses}, so matchers written for the shell
 * keep working. The one remaining divergence is backslash escapes: `\d` and `\w` are literal
 * characters in ERE but metacharacters here, so an ERE matcher relying on that literal reading — a
 * vanishingly rare thing to write on purpose — now means something else.
 */
export function matchesCheckName(matcher: Matcher, checkName: string): boolean {
  return matcher.regex === undefined ? checkName === matcher.raw : matcher.regex.test(checkName);
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
