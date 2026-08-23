import { ExtraParseError, UnsafeKeyError } from './errors.js';

/** Anything the payload can express. JSON has no `undefined`, no functions and no cycles. */
export type PayloadValue = boolean | null | number | PayloadValue[] | PayloadMap | string;

export interface PayloadMap {
  [key: string]: PayloadValue;
}

/**
 * Keys that resolve to `Object.prototype` rather than to data.
 *
 * `JSON.parse` materializes `__proto__` as an own property instead of assigning through the setter,
 * so the parsed value is not itself a pollution vector. They are rejected anyway, for the same
 * reason render-template rejects them: `{{ constructor.constructor }}` is the classic Handlebars
 * sandbox escape, and this payload is rendered by that template.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** How deep `extra` may nest before the recursion below is the thing that fails. */
const MAX_DEPTH = 64;

/** Renders the position of a value for an error message, e.g. `$.publish.crates[3]`. */
function describePath(segments: readonly string[]): string {
  return segments.length === 0 ? '$' : `$${segments.join('')}`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rebuilds a parsed value, rejecting any key that would reach the prototype.
 *
 * Rebuilt rather than validated in place, so the returned payload contains only values this function
 * has walked. There is no path by which an unchecked key survives into the render.
 */
function sanitize(value: unknown, segments: string[], depth: number): PayloadValue {
  if (depth > MAX_DEPTH) {
    throw new ExtraParseError(`nesting at '${describePath(segments)}' exceeds the maximum depth of ${MAX_DEPTH}.`);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitize(entry, [...segments, `[${index}]`], depth + 1));
  }

  if (isPlainObject(value)) {
    const result: PayloadMap = {};

    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new UnsafeKeyError(key, describePath(segments));
      }

      result[key] = sanitize(value[key], [...segments, `.${key}`], depth + 1);
    }

    return result;
  }

  // Everything `JSON.parse` can still produce here is a primitive the renderer can stringify.
  return value as PayloadValue;
}

/**
 * Parses the `extra` input into the map merged over the derived payload.
 *
 * Strict JSON, deliberately: the input is a machine-produced payload more often than a hand-written
 * one, and one parser with one failure mode is what keeps the render reproducible. An empty input is
 * an empty map rather than an error, so a caller with nothing to add needs no `with:` entry.
 *
 * @throws {ExtraParseError} if the input is not JSON, or is JSON but not an object.
 * @throws {UnsafeKeyError} if any key would reach `Object.prototype`.
 */
export function parseExtra(raw: string): PayloadMap {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new ExtraParseError('not valid JSON.', error);
  }

  if (!isPlainObject(parsed)) {
    throw new ExtraParseError('the top level is not a JSON object.');
  }

  return sanitize(parsed, [], 0) as PayloadMap;
}

/**
 * Merges `overlay` over `base`, recursing into objects and replacing everything else.
 *
 * Arrays replace rather than concatenate. A caller supplying `publish.crates` means *these are the
 * crates*, and appending to a derived list would make the result depend on what the reader happened
 * to find — which is exactly the drift this action exists to remove.
 *
 * `null` in the overlay also replaces, which is how a caller deletes a derived field: the template's
 * `{{#if}}` reads it as absent, and strict mode still finds the name defined.
 */
export function deepMerge(base: PayloadMap, overlay: PayloadMap): PayloadMap {
  const result: PayloadMap = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    const existing = result[key];

    result[key] =
      isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing as PayloadMap, value as PayloadMap) : value;
  }

  return result;
}
