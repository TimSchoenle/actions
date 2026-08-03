/**
 * Parsing and validation of everything the caller controls.
 *
 * The action rewrites a Helm chart on a branch a bot is about to open a pull request from, so every
 * input is treated as untrusted: a key that addresses something other than an image tag, a value
 * that is not a tag, or a name that reaches an object prototype must be rejected before a single
 * byte is written. The rules here are structural and non-negotiable; `key-pattern` and
 * `value-pattern` are an *additional* allowlist layered on top, never a replacement.
 */

/** Raised for any malformed or disallowed input. Always names the offending input and entry. */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/**
 * Variables of one template expansion, keyed by placeholder name.
 *
 * A `Map` rather than an object: a plain object carries `Object.prototype`, so a bag built from
 * caller JSON would answer to `constructor` and `toString` as though the caller had supplied them.
 * A `Map` has no such inherited keys, which removes the question entirely rather than answering it
 * with a denylist.
 */
export type VariableBag = ReadonlyMap<string, string>;

/** One image to update: where it goes in `values.yaml`, and the variables that render its value. */
export interface ImageEntry {
  readonly key: string;
  readonly variables: VariableBag;
}

/**
 * Names that address the prototype chain rather than data. `Map` already makes them inert as
 * variable names, but a *key path* is handed to the YAML document's `getIn`/`setIn`, so the check
 * has to exist for keys regardless.
 */
const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** One level of a dot-path. Digits are allowed because a numeric segment indexes a sequence. */
const KEY_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** A placeholder name. Lowercase-initial by construction, which also excludes `__proto__`. */
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * A variable value. Deliberately narrower than "a string": the charset covers image references
 * (`ghcr.io/owner/name`, `v1.2.3`, `sha256:…`) and excludes every character that carries meaning in
 * YAML, Markdown or a shell — notably newlines, backticks, pipes and quotes. A value that reaches
 * the document, a pull request body and a job log should not be able to mean something different in
 * any of the three.
 */
const VARIABLE_VALUE = /^[A-Za-z0-9._:@/+-]{1,256}$/;

const MAX_ENTRIES = 100;
const MAX_KEY_DEPTH = 10;
const MAX_KEY_LENGTH = 256;

/**
 * Cap on a caller-supplied pattern. `key-pattern` and `value-pattern` are compiled with `RegExp`, so
 * a pathological pattern is a way to hang a billed runner. Length is not a soundness guarantee
 * against catastrophic backtracking, but it bounds what can be attempted, and the patterns are
 * matched only against inputs this module has already length-capped.
 */
const MAX_PATTERN_LENGTH = 512;

function describeType(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  return Array.isArray(value) ? 'an array' : `a ${typeof value}`;
}

/**
 * Parses one input as a JSON object.
 *
 * Arrays and `null` are rejected explicitly: both are `typeof 'object'`, and silently accepting
 * either would produce an empty set of updates rather than an error, which reads as a successful
 * no-op release.
 */
function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new InvalidInputError(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidInputError(`${label} must be a JSON object, got ${describeType(parsed)}`);
  }

  return parsed as Record<string, unknown>;
}

/**
 * Validates a dot-path structurally, independently of `key-pattern`.
 *
 * These rules hold whatever the caller sets `key-pattern` to. Widening the pattern is a legitimate
 * decision — a chart may keep image references somewhere other than `*.image.tag` — but no pattern
 * may buy the right to an empty segment, an unbounded depth, or a prototype name.
 */
export function assertValidKey(key: string): void {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new InvalidInputError(`images key must be 1..${MAX_KEY_LENGTH} characters, got ${key.length}`);
  }

  const segments = key.split('.');

  if (segments.length > MAX_KEY_DEPTH) {
    throw new InvalidInputError(`images key '${key}' is ${segments.length} levels deep, the limit is ${MAX_KEY_DEPTH}`);
  }

  for (const segment of segments) {
    if (!KEY_SEGMENT.test(segment)) {
      throw new InvalidInputError(`images key '${key}' has an invalid segment '${segment}'`);
    }

    if (FORBIDDEN_SEGMENTS.has(segment)) {
      throw new InvalidInputError(`images key '${key}' addresses the prototype chain via '${segment}'`);
    }
  }
}

/** Converts an already-parsed JSON object into a validated variable bag. */
function toVariableBag(record: Record<string, unknown>, label: string): VariableBag {
  const bag = new Map<string, string>();

  for (const [name, value] of Object.entries(record)) {
    if (!VARIABLE_NAME.test(name)) {
      throw new InvalidInputError(`${label} has an invalid variable name '${name}'`);
    }

    if (typeof value !== 'string') {
      throw new InvalidInputError(`${label} variable '${name}' must be a string, got ${describeType(value)}`);
    }

    if (!VARIABLE_VALUE.test(value)) {
      throw new InvalidInputError(`${label} variable '${name}' has a disallowed value '${value}'`);
    }

    bag.set(name, value);
  }

  return bag;
}

/** Parses the shared `variables` input. Empty by design: most charts have nothing genuinely shared. */
export function parseVariables(raw: string): VariableBag {
  return toVariableBag(parseJsonObject(raw, 'variables'), 'variables');
}

/**
 * Parses the `images` input into one entry per key, preserving the caller's order so the pull
 * request body lists the images the way the caller wrote them.
 */
export function parseImages(raw: string): ImageEntry[] {
  const record = parseJsonObject(raw, 'images');
  const keys = Object.keys(record);

  if (keys.length === 0) {
    throw new InvalidInputError('images must contain at least one key');
  }

  if (keys.length > MAX_ENTRIES) {
    throw new InvalidInputError(`images has ${keys.length} entries, the limit is ${MAX_ENTRIES}`);
  }

  return keys.map((key) => {
    assertValidKey(key);

    const value = record[key];

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new InvalidInputError(`images['${key}'] must be a JSON object of variables, got ${describeType(value)}`);
    }

    return { key, variables: toVariableBag(value as Record<string, unknown>, `images['${key}']`) };
  });
}

/** Layers an entry's own variables over the shared defaults. The entry always wins. */
export function mergeVariables(shared: VariableBag, own: VariableBag): VariableBag {
  return new Map([...shared, ...own]);
}

/** Compiles a caller-supplied allowlist pattern. */
export function compilePattern(raw: string, label: string): RegExp {
  if (raw.length === 0 || raw.length > MAX_PATTERN_LENGTH) {
    throw new InvalidInputError(`${label} must be 1..${MAX_PATTERN_LENGTH} characters, got ${raw.length}`);
  }

  // The pattern is the whole point of the input: it lets a chart that keeps image references
  // somewhere other than `*.image.tag` say where. It is bounded above, and only ever matched against
  // strings this module has already capped by MAX_KEY_LENGTH or VARIABLE_VALUE.
  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- See above.
    return new RegExp(raw);
  } catch (error) {
    throw new InvalidInputError(
      `${label} is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Applies an allowlist pattern, naming both the subject and the pattern when it does not match. */
export function assertMatches(pattern: RegExp, subject: string, description: string): void {
  if (!pattern.test(subject)) {
    throw new InvalidInputError(`${description} '${subject}' does not match ${pattern.source}`);
  }
}

/** Parses a positive integer input, such as the changelog byte cap. */
export function parsePositiveInteger(raw: string, label: string, fallback: number): number {
  if (raw.trim() === '') {
    return fallback;
  }

  if (!/^\d+$/.test(raw.trim())) {
    throw new InvalidInputError(`${label} must be a positive integer, got '${raw}'`);
  }

  const parsed = Number(raw.trim());

  if (parsed === 0) {
    throw new InvalidInputError(`${label} must be greater than zero`);
  }

  return parsed;
}
