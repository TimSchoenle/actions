import { UnsafeVariableKeyError, VariablesParseError } from './errors.js';

/** Anything the `variables` input can express. JSON has no `undefined`, no functions and no cycles. */
export type TemplateValue = string | number | boolean | null | TemplateValue[] | TemplateMap;

/** A map of template variables. */
export interface TemplateMap {
  [key: string]: TemplateValue;
}

/**
 * Keys that resolve to `Object.prototype` rather than to data.
 *
 * `JSON.parse` already materializes `__proto__` as an own property instead of assigning through the
 * setter, so the parsed value itself is not a pollution vector. These are rejected anyway because
 * they are a vector on the *template* side — `{{ constructor.constructor }}` is the classic
 * Handlebars sandbox escape — and because a variable named after one of them is a mistake worth
 * reporting rather than a value worth rendering.
 *
 * Rejecting the keys is the first of two defences; the renderer additionally denies Handlebars any
 * prototype access at runtime. A null prototype on the maps themselves would be a third, and is
 * deliberately not used: Handlebars builds its strict-mode error by concatenating the context into a
 * string, which throws `TypeError: Cannot convert object to primitive value` on a prototype-less
 * object — turning every "variable not defined" report, the most common failure this action has,
 * into an unreadable one.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * How deep a variables map may nest.
 *
 * The sanitizer below recurses, so an adversarially nested document would exhaust the stack and
 * surface as an opaque `RangeError` instead of a diagnosable failure. No real template context comes
 * anywhere near this.
 */
const MAX_DEPTH = 64;

/** Renders the position of a value for an error message, e.g. `$.actions[3].name`. */
function describePath(segments: readonly string[]): string {
  return segments.length === 0 ? '$' : `$${segments.join('')}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rebuilds a parsed JSON value, rejecting any key that would reach the prototype.
 *
 * Rebuilt rather than validated in place so the returned context contains only values this function
 * has walked — there is no path by which an unchecked key survives into the render.
 */
function sanitize(value: unknown, segments: string[], depth: number): TemplateValue {
  if (depth > MAX_DEPTH) {
    throw new VariablesParseError(`nesting at '${describePath(segments)}' exceeds the maximum depth of ${MAX_DEPTH}.`);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitize(entry, [...segments, `[${index}]`], depth + 1));
  }

  if (isPlainObject(value)) {
    const result: TemplateMap = {};

    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new UnsafeVariableKeyError(key, describePath(segments));
      }

      result[key] = sanitize(value[key], [...segments, `.${key}`], depth + 1);
    }

    return result;
  }

  // Everything `JSON.parse` can still produce here is a primitive the renderer can stringify as-is.
  return value as TemplateValue;
}

/**
 * Parses the `variables` input into the context a template is rendered against.
 *
 * Strict JSON, deliberately: the input is a machine-produced payload as often as it is hand-written,
 * and a single parser with one failure mode is what makes the rendering reproducible. An empty input
 * is an empty context rather than an error, so a template with no variables needs no `with:` entry.
 *
 * The top level must be an object. A template is rendered against a map of names; an array or a bare
 * scalar leaves every `{{ name }}` in the template unresolvable, which is a mistake worth catching at
 * the input rather than as a rendering failure further along.
 *
 * @throws {VariablesParseError} if the input is not strict JSON, or is JSON but not an object.
 * @throws {UnsafeVariableKeyError} if any key anywhere in the document would reach the prototype.
 */
export function parseVariables(raw: string): TemplateMap {
  if (raw.trim() === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VariablesParseError(
      `is not valid JSON. ${error instanceof Error ? error.message : String(error)}`.trim(),
      error,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new VariablesParseError(`must be a JSON object, got ${Array.isArray(parsed) ? 'an array' : typeof parsed}.`);
  }

  return sanitize(parsed, [], 0) as TemplateMap;
}
