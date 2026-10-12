/**
 * The failures this action reports.
 *
 * An {@link InvalidInputError} names the input of the *composite* action (`fail-on-severity`), not of
 * this helper (`fail_on_severity`), because the composite is the only interface a workflow author sees.
 */

/** An action input is not a value this action can use, reported before the container is started. */
export class InvalidInputError extends Error {
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`${input}: ${reason}`);
    this.name = 'InvalidInputError';
  }
}

/** One or more inputs start with a byte order mark, found before zizmor would have stopped at the first. */
export class ByteOrderMarkError extends Error {
  constructor(readonly files: readonly string[]) {
    super(
      `${files.length} input file(s) start with a UTF-8 byte order mark, which zizmor cannot parse. ` +
        'Each is annotated above. Save them as UTF-8 without a BOM.',
    );
    this.name = 'ByteOrderMarkError';
  }
}

/** zizmor, or the container it runs in, did not produce a usable SARIF file. */
export class ZizmorRunError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ZizmorRunError';
  }
}

/** A SARIF file is not one this action can count findings in. */
export class SarifFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SarifFormatError';
  }
}

/** Findings at or above the configured severity. Raised after the outputs and the summary are written. */
export class FindingsError extends Error {
  constructor(
    readonly failing: number,
    threshold: string,
  ) {
    super(`${failing} zizmor finding(s) at or above ${threshold}. Each is listed above and in the job summary.`);
    this.name = 'FindingsError';
  }
}
