/**
 * The failure this action reports.
 *
 * An {@link InvalidInputError} names the input of the *composite* action (`paths-ignore`), not of
 * this helper (`paths_ignore`), because the composite is the only interface a workflow author sees.
 */

/** An action input is not a value this action can use, reported before CodeQL is initialised. */
export class InvalidInputError extends Error {
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`${input}: ${reason}`);
    this.name = 'InvalidInputError';
  }
}
