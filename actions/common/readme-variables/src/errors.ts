/**
 * The failures this action reports, one class per situation a caller can actually act on.
 *
 * Every message names the path or the input it is about. A payload step fails inside a workflow log
 * with no surrounding context, and "not found" without a path costs the caller a round trip to work
 * out which of the four candidate manifests was meant.
 */

/** No manifest was given and none of the candidates exists in the workspace. */
export class ManifestNotFoundError extends Error {
  constructor(
    readonly candidates: readonly string[],
    cause?: unknown,
  ) {
    super(
      `no manifest found. Looked for ${candidates.join(', ')} in the workspace root; ` +
        `pass 'manifest' explicitly if it lives elsewhere.`,
      { cause },
    );
    this.name = 'ManifestNotFoundError';
  }
}

/** The `manifest` input names a path that cannot be read. */
export class ManifestUnreadableError extends Error {
  constructor(
    readonly path: string,
    cause?: unknown,
  ) {
    super(`${path}: manifest not found or not readable.`, { cause });
    this.name = 'ManifestUnreadableError';
  }
}

/** The manifest was read but is not the shape its filename promises. */
export class ManifestParseError extends Error {
  constructor(
    readonly path: string,
    reason: string,
    cause?: unknown,
  ) {
    super(`${path}: ${reason}`, { cause });
    this.name = 'ManifestParseError';
  }
}

/**
 * A field the payload cannot be assembled without is missing from the manifest.
 *
 * Separate from {@link ManifestParseError} because the fix is different: the file parsed, so the
 * caller edits a field rather than the syntax. `version.workspace = true` in a Cargo member is the
 * common case, and the message says so rather than reporting a bare absence.
 */
export class ManifestFieldMissingError extends Error {
  constructor(
    readonly path: string,
    readonly field: string,
    hint?: string,
  ) {
    super(`${path}: no '${field}'.${hint === undefined ? '' : ` ${hint}`}`);
    this.name = 'ManifestFieldMissingError';
  }
}

/** The `extra` input is not strict JSON, or is JSON but not an object. */
export class ExtraParseError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(`extra: ${reason}`, { cause });
    this.name = 'ExtraParseError';
  }
}

/**
 * The `extra` payload carries a key that would reach `Object.prototype`.
 *
 * Rejected rather than stripped, on the same terms as render-template's variables: a payload
 * carrying `constructor` is either a mistake or an attack, and silently dropping it hides both.
 */
export class UnsafeKeyError extends Error {
  constructor(
    readonly key: string,
    readonly at: string,
  ) {
    super(`extra: key '${key}' at ${at} is not allowed; it would resolve to Object.prototype.`);
    this.name = 'UnsafeKeyError';
  }
}

/** The `repository` input is not `owner/name`. */
export class RepositoryFormatError extends Error {
  constructor(readonly value: string) {
    super(`repository: '${value}' is not in owner/name form.`);
    this.name = 'RepositoryFormatError';
  }
}
