/**
 * The failures this action reports, one class per situation a caller can actually act on.
 *
 * Every message names the path it is about. A rendering step fails inside a workflow log with no
 * surrounding context, so "not found" without a path costs the caller a round trip to find out which
 * of the two paths it was.
 */

/** The template file, or a partial, could not be read. */
export class TemplateNotFoundError extends Error {
  constructor(
    readonly path: string,
    cause?: unknown,
  ) {
    super(`${path}: template file not found or not readable.`, { cause });
    this.name = 'TemplateNotFoundError';
  }
}

/** The `partials-dir` input points at something that is not a readable directory. */
export class PartialsDirectoryNotFoundError extends Error {
  constructor(
    readonly path: string,
    cause?: unknown,
  ) {
    super(`${path}: partials directory not found or not readable.`, { cause });
    this.name = 'PartialsDirectoryNotFoundError';
  }
}

/** The `variables` input is not strict JSON, or is JSON but not an object. */
export class VariablesParseError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(`variables: ${reason}`, { cause });
    this.name = 'VariablesParseError';
  }
}

/**
 * The variables contain a key that would reach `Object.prototype`.
 *
 * Rejected rather than stripped: a template that reads `{{ constructor }}` is either a mistake or an
 * attack, and silently rendering nothing would hide both.
 */
export class UnsafeVariableKeyError extends Error {
  constructor(
    readonly key: string,
    readonly path: string,
  ) {
    super(`variables: '${key}' at '${path}' is not an allowed key — it would reach the object prototype.`);
    this.name = 'UnsafeVariableKeyError';
  }
}

/** A template or partial is not valid Handlebars. */
export class TemplateCompileError extends Error {
  constructor(
    readonly path: string,
    reason: string,
    cause?: unknown,
  ) {
    super(`${path}: template could not be compiled. ${reason}`.trim(), { cause });
    this.name = 'TemplateCompileError';
  }
}

/**
 * A template reads root-scope names the variables do not define, under `strict`.
 *
 * Reported before rendering and with every missing name at once, rather than one per run: the names
 * come from a single JSON payload the caller assembles, so fixing them one failed workflow at a time
 * is pure latency.
 */
export class UndefinedReferenceError extends Error {
  constructor(
    readonly path: string,
    readonly names: readonly string[],
  ) {
    super(
      `${path}: references ${names.length === 1 ? 'a variable' : 'variables'} that 'variables' does not define: ` +
        `${names.join(', ')}. Declare ${names.length === 1 ? 'it' : 'them'} — a flag that is off is 'false', not absent — or set 'strict: false'.`,
    );
    this.name = 'UndefinedReferenceError';
  }
}

/** A template compiled but threw while rendering — a missing reference under `strict`, typically. */
export class TemplateRenderError extends Error {
  constructor(
    readonly path: string,
    reason: string,
    cause?: unknown,
  ) {
    super(`${path}: template could not be rendered. ${reason}`.trim(), { cause });
    this.name = 'TemplateRenderError';
  }
}

/** `check` was requested and the file on disk is not what the template renders to. */
export class OutputDriftError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`${path}: is out of date. ${detail}`, { cause: undefined });
    this.name = 'OutputDriftError';
  }
}
