/**
 * The generator's own arguments, read as a vector rather than assembled as a command line.
 *
 * `extra_args` exists because the generator this action drives is not always a program with one
 * rendering to give: a workspace that publishes nine images renders nine contracts from one binary,
 * selected by an argument only that repository knows the spelling of. The action cannot validate
 * such an argument against a grammar it does not own, so it validates the *shape* instead — that
 * what arrives is a list of arguments, that each is one argument, and that none of them is one of
 * the two the action supplies itself.
 *
 * Quoting is read here and nowhere else. Nothing downstream re-splits: the vector goes to
 * `@actions/exec` as an array, so a quoted value containing a space stays one argument all the way
 * to the generator. That is the whole reason this is a parser and not an interpolation.
 */
import { InvalidInputError } from './errors.js';

/** Quote characters that open a span in which whitespace is ordinary. */
const QUOTES = new Set(['"', "'"]);

/**
 * Anything a token may not contain, whatever quoted it.
 *
 * Separators are consumed by the split, so a token can only carry one of these if it was quoted —
 * and a newline inside an argument is a line the runner reads for workflow commands, a NUL is not
 * something `execve` can carry, and neither is a value a generator has any use for.
 */
// eslint-disable-next-line no-control-regex -- the point of this pattern is the control characters.
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

/**
 * Arguments the action supplies itself, which a caller may not also supply.
 *
 * `--format` is how one run is told from the next and `--path` is what the embedded-contract check
 * compares against. A second spelling of either would leave the action reporting on a rendering it
 * did not ask for, which is the one failure mode the whole scheme exists to remove. Refused in both
 * spellings, since `--format=labels` is the same argument written differently.
 */
const RESERVED_ARGUMENTS = ['--format', '--path'];

/** Most arguments one generator can plausibly need; past this the input is a mistake, not a list. */
const MAX_ARGUMENTS = 32;

/** Longest the whole input may be, well past any real argument list and short of a flood. */
const MAX_LENGTH = 4096;

/** Whether a token is one of {@link RESERVED_ARGUMENTS}, in either spelling. */
function isReserved(token: string): boolean {
  return RESERVED_ARGUMENTS.some((reserved) => token === reserved || token.startsWith(`${reserved}=`));
}

/**
 * Splits an input into tokens on unquoted whitespace.
 *
 * A quote opens a span that ends at the matching quote and is otherwise literal — there is no
 * escape character, because a backslash is an ordinary character in the Windows paths and regular
 * expressions an argument may carry, and reading it as an escape would silently eat one. A span
 * that is never closed is refused rather than run to the end of the input, since the difference
 * between the two readings is an argument boundary.
 *
 * @throws {InvalidInputError} when a quoted span is never closed.
 */
function tokenize(value: string, input: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let started = false;
  let quote: string | undefined;

  const end = (): void => {
    if (started) {
      tokens.push(token);
      token = '';
      started = false;
    }
  };

  for (const character of value) {
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        token += character;
      }
    } else if (QUOTES.has(character)) {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      end();
    } else {
      token += character;
      started = true;
    }
  }

  if (quote !== undefined) {
    throw new InvalidInputError(input, `has an unclosed ${quote === '"' ? 'double' : 'single'} quote.`);
  }

  end();

  return tokens;
}

/**
 * Reads one input as the argument vector a generator is handed.
 *
 * @param value the raw input, empty for no extra arguments at all.
 * @param input the input's name, which is what every message quotes.
 * @throws {InvalidInputError} for an unclosed quote, a reserved argument, a control character or a
 * list past {@link MAX_ARGUMENTS}.
 */
export function parseArgumentVector(value: string, input: string): string[] {
  if (value.trim() === '') {
    return [];
  }

  if (value.length > MAX_LENGTH) {
    throw new InvalidInputError(input, `is ${value.length} characters, past the limit of ${MAX_LENGTH}.`);
  }

  const tokens = tokenize(value, input);

  for (const token of tokens) {
    if (CONTROL_CHARACTER.test(token)) {
      throw new InvalidInputError(input, 'holds an argument containing a control character.');
    }

    if (isReserved(token)) {
      throw new InvalidInputError(
        input,
        `must not pass '${token}': --format and --path are this action's own arguments, and a second spelling of ` +
          'either would have it report on a rendering it did not ask for.',
      );
    }
  }

  if (tokens.length > MAX_ARGUMENTS) {
    throw new InvalidInputError(input, `holds ${tokens.length} arguments, past the limit of ${MAX_ARGUMENTS}.`);
  }

  return tokens;
}
