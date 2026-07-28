import type Handlebars from 'handlebars';

/** The isolated Handlebars environment a single render runs in. */
export type HandlebarsEnvironment = ReturnType<typeof Handlebars.create>;

/** A helper as this module writes them: positional arguments in, a renderable value out. */
type Helper = (...args: unknown[]) => unknown;

/** The trailing argument Handlebars appends to every helper call. */
interface HelperOptions {
  name: unknown;
  hash: unknown;
}

/** The default separator for {@link joinValues}, matching how a Markdown list of tags reads. */
const DEFAULT_SEPARATOR = ', ';

/** Characters with structural meaning in Markdown inline text, escaped by `mdEscape`. */
const MARKDOWN_SPECIALS = /[\\`*_{}[\]()#+\-.!|>~]/g;

/**
 * Strips the options object Handlebars appends to every helper invocation.
 *
 * Helpers here take optional positional arguments (`join` with and without a separator), so they
 * cannot simply index a fixed position — the options object would be read as the caller's argument.
 * It is identified structurally because Handlebars constructs it as a plain object literal, so there
 * is no class to test against.
 */
function positional(args: readonly unknown[]): unknown[] {
  const last = args.at(-1);
  const isOptions =
    typeof last === 'object' && last !== null && 'hash' in last && 'name' in (last as unknown as HelperOptions);

  return isOptions ? args.slice(0, -1) : [...args];
}

/** Renders a value the way an interpolation would, so helpers agree with `{{ value }}`. */
function text(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * Orders two values without consulting a locale.
 *
 * `localeCompare` is the obvious choice and the wrong one: its result depends on the runner's ICU
 * data, so the same template and the same variables would sort differently on two machines and the
 * rendered file would flip back and forth in version control. Numbers compare numerically, anything
 * else by code point.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  const left = text(a);
  const right = text(b);

  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

/** Handlebars' notion of falsy, so `{{#if (or a b)}}` agrees with `{{#if a}}`. */
function isTruthy(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value === null || value === undefined ? [] : [value];
}

function joinValues(...args: unknown[]): string {
  const [value, separator] = positional(args);

  return asArray(value)
    .map((entry) => text(entry))
    .join(typeof separator === 'string' ? separator : DEFAULT_SEPARATOR);
}

/**
 * Escapes a value for a single Markdown table cell.
 *
 * A cell is terminated by `|` and by the end of the line, so an unescaped pipe silently splits one
 * column into two and a newline truncates the whole row. Both are exactly what a description field
 * pulled out of an `action.yaml` contains, which makes this the helper a generated table needs most.
 * Backslashes go first so the escapes this adds are not themselves re-escaped.
 */
function markdownCell(...args: unknown[]): string {
  const [value] = positional(args);

  return text(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll(/\r\n|[\n\r]/g, '<br>');
}

function markdownEscape(...args: unknown[]): string {
  const [value] = positional(args);

  return text(value).replaceAll(MARKDOWN_SPECIALS, (match) => `\\${match}`);
}

function sortValues(...args: unknown[]): unknown[] {
  const [value] = positional(args);

  return asArray(value).toSorted(compareValues);
}

/**
 * Orders a list of records by one property, leaving ties in their original order.
 *
 * The sort is stable (`toSorted` is), so two entries with the same key keep the order the caller
 * supplied them in rather than an order the engine happens to produce — the difference between a
 * generated table that is reproducible and one that reshuffles between runs.
 */
function sortByKey(...args: unknown[]): unknown[] {
  const [value, key] = positional(args);
  const property = text(key);

  return asArray(value).toSorted((a, b) => compareValues(readProperty(a, property), readProperty(b, property)));
}

function readProperty(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) {
    return undefined;
  }

  return Object.hasOwn(source, key) ? (source as Record<string, unknown>)[key] : undefined;
}

function countOf(...args: unknown[]): number {
  const [value] = positional(args);

  if (Array.isArray(value) || typeof value === 'string') {
    return value.length;
  }

  return typeof value === 'object' && value !== null ? Object.keys(value).length : 0;
}

function stringifyJson(...args: unknown[]): string {
  const [value, indent] = positional(args);

  return JSON.stringify(value, undefined, typeof indent === 'number' ? indent : 0) ?? '';
}

function fallback(...args: unknown[]): unknown {
  const [value, alternative] = positional(args);

  return value === undefined || value === null || value === '' ? alternative : value;
}

function replaceAll(...args: unknown[]): string {
  const [value, search, replacement] = positional(args);
  const needle = text(search);

  // A literal replacement, never a pattern: a caller-supplied regular expression in a template is a
  // denial-of-service waiting for the right input, and nothing a README needs.
  return needle === '' ? text(value) : text(value).replaceAll(needle, text(replacement));
}

/**
 * The helpers every template may use.
 *
 * Curated on one rule: a helper must return the same output for the same input, forever. That rules
 * out the conveniences a templating engine usually ships with — `now`, `random`, `uuid`, anything
 * reading the environment — because a file regenerated from unchanged inputs has to come out
 * byte-identical, or the drift check this action offers is worthless and every run produces a diff.
 */
export const HELPERS: Readonly<Record<string, Helper>> = Object.freeze({
  eq: (...args: unknown[]) => {
    const [a, b] = positional(args);
    return a === b;
  },
  ne: (...args: unknown[]) => {
    const [a, b] = positional(args);
    return a !== b;
  },
  lt: (...args: unknown[]) => {
    const [a, b] = positional(args);
    return compareValues(a, b) < 0;
  },
  gt: (...args: unknown[]) => {
    const [a, b] = positional(args);
    return compareValues(a, b) > 0;
  },
  and: (...args: unknown[]) => positional(args).every((value) => isTruthy(value)),
  or: (...args: unknown[]) => positional(args).some((value) => isTruthy(value)),
  not: (...args: unknown[]) => !isTruthy(positional(args)[0]),
  count: countOf,
  default: fallback,
  join: joinValues,
  json: stringifyJson,
  lower: (...args: unknown[]) => text(positional(args)[0]).toLowerCase(),
  mdCell: markdownCell,
  mdEscape: markdownEscape,
  replace: replaceAll,
  sort: sortValues,
  sortBy: sortByKey,
  trim: (...args: unknown[]) => text(positional(args)[0]).trim(),
  upper: (...args: unknown[]) => text(positional(args)[0]).toUpperCase(),
});

/** Binds {@link HELPERS} to one isolated environment. */
export function registerHelpers(environment: HandlebarsEnvironment): void {
  for (const [name, helper] of Object.entries(HELPERS)) {
    environment.registerHelper(name, helper);
  }
}
