/**
 * The failures this action reports, one class per situation a caller can act on.
 *
 * Every class names what went wrong in the caller's terms. An {@link InvalidInputError} names the
 * input of the *composite* action (`size-warning-mib`), not of this helper (`size_warning_mib`),
 * because the composite is the only interface a workflow author ever sees.
 */

/** An action input is not a value this action can use, reported before anything is run. */
export class InvalidInputError extends Error {
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`${input}: ${reason}`);
    this.name = 'InvalidInputError';
  }
}

/** A `docker` invocation failed, or answered with something that is not what it documents. */
export class DockerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DockerError';
  }
}

/** The SARIF file Trivy wrote cannot be read as a SARIF log. */
export class SarifError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SarifError';
  }
}

/** The plan file one phase hands the next is missing, outside `RUNNER_TEMP`, or malformed. */
export class PlanError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PlanError';
  }
}

/** One or more gates refused the image. Raised last, after every result has been published. */
export class GateError extends Error {
  constructor(readonly failures: readonly string[]) {
    super(failures.join(' '));
    this.name = 'GateError';
  }
}
