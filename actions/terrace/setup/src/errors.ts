/**
 * The failures this action reports, one class per situation a caller can act on.
 *
 * Every one fails the step: an install that could not be proven authentic must never leave a binary
 * on `PATH`, so there is no warning path here.
 */

/** An action input, or the `terrace.yaml` standing in for one, is not a value this action can use. */
export class InvalidInputError extends Error {
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`${input}: ${reason}`);
    this.name = 'InvalidInputError';
  }
}

/** No release of a tool is published for the runner's operating system and architecture. */
export class UnsupportedPlatformError extends Error {
  constructor(tool: string, platform: string, arch: string) {
    super(`${tool} publishes no release for ${platform}/${arch}.`);
    this.name = 'UnsupportedPlatformError';
  }
}

/** The requested terrace-contract version names no published release. */
export class ReleaseNotFoundError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ReleaseNotFoundError';
  }
}

/** A downloaded file is not the one its publisher signed or listed. */
export class VerificationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'VerificationError';
  }
}
