import { runInNewContext } from 'node:vm';

/**
 * Upper bound for a single pattern evaluation.
 *
 * The values these patterns are matched against are attacker-influenced — a fork can name its branch
 * anything, and a check run's name comes from whatever workflow produced it — so a poorly written
 * pattern can be pushed into catastrophic backtracking. Evaluation therefore runs inside a V8 context
 * that is terminated once the budget is exhausted, turning a hung job into a failed step.
 */
export const PATTERN_MATCH_TIMEOUT_MS = 1000;

/**
 * POSIX bracket expression classes, translated to their JavaScript character-range equivalents.
 *
 * The shell predecessors of these actions matched with bash `[[ ... =~ ... ]]`, i.e. POSIX extended
 * regular expressions, which support `[[:digit:]]`-style classes that JavaScript's RegExp does not.
 * Translating them keeps patterns written for the shell working — an untranslated class compiles to a
 * regex that matches nothing, and "matches nothing" is a silent pass in every action that uses one.
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

/**
 * Compiles a POSIX-ERE-flavoured pattern into a RegExp, mirroring the unanchored, case-sensitive
 * semantics of bash's `[[ $value =~ $pattern ]]`.
 *
 * Dialect note: ordinary patterns behave identically in both dialects and POSIX bracket classes are
 * translated by {@link translatePosixClasses}. The one remaining divergence is backslash escapes:
 * `\d` and `\w` are literal characters in ERE but metacharacters here, so an ERE pattern relying on
 * that literal reading — a vanishingly rare thing to write on purpose — now means something else.
 *
 * @throws {SyntaxError} if the translated pattern is not a valid RegExp. Callers wrap this in an
 * error that names the input the pattern came from; nothing silently downgrades an uncompilable
 * pattern to a literal comparison, because a typo'd pattern that matches nothing reads as a pass.
 */
export function compilePosixRegex(pattern: string): RegExp {
  // eslint-disable-next-line security/detect-non-literal-regexp -- matching against a caller-supplied pattern is the purpose of every consumer of this function; evaluation is time-boxed in testPattern
  return new RegExp(translatePosixClasses(pattern));
}

/**
 * Tests values against a compiled pattern under a hard time budget, shared by the whole batch.
 *
 * Batching is not an optimization detail, it is the contract: the budget bounds the work a single
 * pattern can cause in total. Evaluating one value per context would let a pattern that stays just
 * under the budget on each of `n` values burn `n × timeoutMs` before anything noticed — and would
 * pay for a fresh V8 context every time, which costs roughly three orders of magnitude more than the
 * match itself.
 *
 * @throws if the batch exceeds `timeoutMs` — see {@link PATTERN_MATCH_TIMEOUT_MS}. Callers wrap this
 * in an error naming the pattern, which is what a human needs to fix it.
 */
export function testPatterns(
  regex: RegExp,
  values: readonly string[],
  timeoutMs: number = PATTERN_MATCH_TIMEOUT_MS,
): boolean[] {
  // `values.map` runs the host realm's `map`, so the result is an ordinary array rather than one
  // belonging to the throwaway context. The timeout terminates the isolate's current execution
  // either way, which is what makes the budget enforceable at all.
  const matches: unknown = runInNewContext(
    'values.map((value) => regex.test(value))',
    { regex, values: [...values] },
    { timeout: timeoutMs },
  );

  return matches as boolean[];
}

/**
 * Tests a single value against a compiled pattern under a hard time budget.
 *
 * @throws if the evaluation exceeds `timeoutMs` — see {@link PATTERN_MATCH_TIMEOUT_MS}.
 */
export function testPattern(regex: RegExp, value: string, timeoutMs: number = PATTERN_MATCH_TIMEOUT_MS): boolean {
  return testPatterns(regex, [value], timeoutMs)[0];
}
