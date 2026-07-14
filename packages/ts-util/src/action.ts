import * as core from '@actions/core';

/**
 * Reported when a step fails with a value that is not an `Error` and therefore carries no message.
 */
const UNKNOWN_ERROR = 'Unknown error occurred';

/** Fails the step with the message of whatever was thrown. */
function failStep(error: unknown): void {
  core.setFailed(error instanceof Error ? error.message : UNKNOWN_ERROR);
}

export function runAction(body: () => Promise<void>): Promise<void>;
export function runAction(body: () => void): void;

/**
 * Runs the body of an action, failing the step with whatever it throws.
 *
 * Every action shares one failure path: an uncaught error fails the step with its message, and
 * nothing escapes as an unhandled rejection — which the runner reports as a crashed process rather
 * than as the failed check the workflow is waiting for. Keeping that in one place is what makes it
 * uniform; ten hand-written `try`/`catch` envelopes drift the moment one of them is improved.
 *
 * A synchronous body stays synchronous: an action whose work needs no I/O must not be forced to
 * return a promise merely to be wrapped, and its tests must not be forced to await one.
 */
export function runAction(body: () => void | Promise<void>): void | Promise<void> {
  try {
    const result = body();

    return result instanceof Promise ? result.catch(failStep) : result;
  } catch (error) {
    failStep(error);
  }
}
