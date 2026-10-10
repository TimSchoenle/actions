/**
 * Turns the raw composite inputs into the validated options the configuration is built from.
 *
 * Pure over strings, so every rule here is unit-tested without a runner. It runs before
 * `codeql-action/init`, so a typo fails the step in a second rather than after the CodeQL bundle has
 * been downloaded and a database half-built.
 *
 * Inputs are reported under the composite's kebab-case names, which is what the workflow author wrote.
 */
import { quoteForLog } from 'actions-util';

import { InvalidInputError } from './errors.js';

/**
 * The CodeQL languages that support `build-mode: none`, each with the aliases CodeQL also accepts.
 *
 * This action builds nothing, and `paths-ignore` is honoured only for a language that is not built,
 * so a language outside this table would either fail `init` or silently analyse the excluded paths.
 *
 * An alias is refused rather than translated. Default setup categorises its uploads by the
 * canonical identifier, and a caller who wrote `typescript` would otherwise be recorded under a
 * category that is not the one in their workflow file.
 */
const LANGUAGE_ALIASES = {
  actions: [],
  'c-cpp': ['c', 'cpp'],
  csharp: [],
  'java-kotlin': ['java', 'kotlin'],
  'javascript-typescript': ['javascript', 'typescript'],
  python: [],
  ruby: [],
  rust: [],
} as const satisfies Record<string, readonly string[]>;

export type Language = keyof typeof LANGUAGE_ALIASES;

/** Every accepted identifier, in the order the table lists them. */
export const LANGUAGES = Object.keys(LANGUAGE_ALIASES) as readonly Language[];

/** The canonical identifier an alias stands for, if it is one. */
function canonicalOf(alias: string): Language | undefined {
  return LANGUAGES.find((language) => (LANGUAGE_ALIASES[language] as readonly string[]).includes(alias));
}

/** Languages CodeQL analyses only by building them, which this action does not do. */
const BUILT_LANGUAGES = new Set(['go', 'swift']);

/**
 * Characters CodeQL's `paths-ignore` matches literally rather than as glob syntax.
 *
 * A pattern holding one does not do what its author meant (`!` does not negate, `?` does not match
 * one character), so it is refused instead of quietly excluding nothing.
 */
const LITERAL_GLOB_CHARACTERS = /[?+[\]!]/;

/** A code scanning category: printable, no whitespace, short enough to be a label. */
const CATEGORY = /^[A-Za-z0-9._/:=-]{1,128}$/;

/** The raw strings the composite hands over, keyed by the composite's own input names. */
export interface RawInputs {
  readonly language: string;
  readonly excludeTestPaths: string;
  readonly pathsIgnore: string;
  readonly category: string;
  readonly upload: string;
}

/** Everything the inputs mean, validated and with every default derived. */
export interface AnalysisOptions {
  readonly language: Language;
  readonly excludeTestPaths: boolean;
  /** The caller's own patterns, trimmed and in the order given. */
  readonly pathsIgnore: readonly string[];
  readonly category: string;
  readonly upload: boolean;
}

/** Parses a boolean the way `core.getBooleanInput` does, under the composite's input name. */
export function parseBoolean(input: string, value: string): boolean {
  const trimmed = value.trim();

  if (['true', 'True', 'TRUE'].includes(trimmed)) {
    return true;
  }

  if (['false', 'False', 'FALSE'].includes(trimmed)) {
    return false;
  }

  throw new InvalidInputError(input, `${quoteForLog(trimmed)} is not a boolean. Expected true or false.`);
}

/**
 * Parses a CodeQL language identifier.
 *
 * @throws {InvalidInputError} for an alias, naming the canonical identifier; for a language that
 * needs a build; and for anything CodeQL does not analyse.
 */
export function parseLanguage(value: string): Language {
  const language = value.trim();

  if ((LANGUAGES as readonly string[]).includes(language)) {
    return language as Language;
  }

  const canonical = canonicalOf(language);

  if (canonical !== undefined) {
    throw new InvalidInputError(
      'language',
      `${quoteForLog(language)} is an alias. Use ${quoteForLog(canonical)}, the identifier default setup ` +
        'categorises its results by.',
    );
  }

  if (BUILT_LANGUAGES.has(language)) {
    throw new InvalidInputError(
      'language',
      `${quoteForLog(language)} has no build-mode none, and this action builds nothing. Use ` +
        'github/codeql-action directly with the build steps it needs.',
    );
  }

  throw new InvalidInputError(
    'language',
    `${quoteForLog(language)} is not a CodeQL language. Expected one of ${LANGUAGES.join(', ')}.`,
  );
}

/**
 * Validates one `paths-ignore` pattern against the glob rules CodeQL documents.
 *
 * `**` is recognised only as a whole path segment, and a handful of characters are matched
 * literally, so either mistake would exclude nothing while looking as if it excluded something.
 * Patterns are relative to the repository root, which rules out a leading `/`, a `.` or `..`
 * segment and Windows separators.
 */
export function parsePattern(pattern: string): string {
  const reject = (reason: string): never => {
    throw new InvalidInputError('paths-ignore', `${quoteForLog(pattern)} ${reason}`);
  };

  if (LITERAL_GLOB_CHARACTERS.test(pattern)) {
    reject('uses ?, +, [, ] or !, which CodeQL matches literally rather than as glob syntax.');
  }

  if (pattern.includes('\\')) {
    reject('contains a backslash. Separate path segments with /.');
  }

  if (pattern.startsWith('/')) {
    reject('is absolute. Patterns are relative to the repository root.');
  }

  for (const segment of pattern.split('/')) {
    if (segment === '.' || segment === '..') {
      reject('has a . or .. segment. Patterns are relative to the repository root.');
    }

    if (segment.includes('**') && segment !== '**') {
      reject('puts ** inside a segment. CodeQL recognises ** only as a whole segment, such as **/fixtures/**.');
    }
  }

  return pattern;
}

/**
 * Parses the `paths-ignore` input: one pattern per line.
 *
 * Blank lines are skipped, and so are lines starting with `#`, so a caller can say next to each
 * pattern why it is excluded. A duplicate is kept once, at its first position.
 */
export function parsePatterns(value: string): string[] {
  const patterns: string[] = [];

  for (const line of value.split('\n')) {
    const pattern = line.trim();

    if (pattern === '' || pattern.startsWith('#')) {
      continue;
    }

    if (!patterns.includes(parsePattern(pattern))) {
      patterns.push(pattern);
    }
  }

  return patterns;
}

/**
 * Resolves the upload category, `/language:<language>` unless the caller names one.
 *
 * The default is the category default setup writes, so switching a repository from default setup
 * to this action keeps one analysis per language instead of opening a second beside the first.
 */
function resolveCategory(value: string, language: Language): string {
  const explicit = value.trim();

  if (explicit === '') {
    return `/language:${language}`;
  }

  if (!CATEGORY.test(explicit)) {
    throw new InvalidInputError(
      'category',
      `${quoteForLog(explicit)} is not a category. Expected up to 128 letters, digits or any of . _ / : = -.`,
    );
  }

  return explicit;
}

/**
 * Validates every input and derives the category.
 *
 * @throws {InvalidInputError} naming the first input that is not usable.
 */
export function resolveOptions(raw: RawInputs): AnalysisOptions {
  const language = parseLanguage(raw.language);

  return {
    language,
    excludeTestPaths: parseBoolean('exclude-test-paths', raw.excludeTestPaths),
    pathsIgnore: parsePatterns(raw.pathsIgnore),
    category: resolveCategory(raw.category, language),
    upload: parseBoolean('upload', raw.upload),
  };
}
