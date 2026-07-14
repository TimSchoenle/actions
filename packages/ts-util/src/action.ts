import * as core from '@actions/core';

import { errorMessage } from './errors.js';

/** Reported when a step fails with a value that carries no message at all. */
const UNKNOWN_ERROR = 'Unknown error occurred';

/**
 * Renders a failure and everything that caused it, one stack per link in the chain.
 *
 * Deliberately narrow: only the stack — or, failing that, the message — of each `Error` in the
 * `cause` chain. An Octokit rejection carries the whole request on it, and dumping that object into
 * the log would print headers; the chain of stacks is what a human debugging the step actually
 * needs, and it cannot carry a credential.
 */
function describeFailure(error: unknown): string {
  const links: string[] = [];

  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    links.push(current.stack ?? `${current.name}: ${current.message}`);
  }

  return links.length > 0 ? links.join('\nCaused by: ') : errorMessage(error);
}

/**
 * Fails the step with the message of whatever was thrown.
 *
 * The message of a non-`Error` is kept rather than discarded: a rejected `throw 'boom'` reaching the
 * log as "Unknown error occurred" tells the caller nothing, and `boom` is what was actually wrong.
 * The generic message is reserved for a value that genuinely says nothing, such as a thrown `null`.
 *
 * The full chain goes to the debug channel, which the runner prints only under `ACTIONS_STEP_DEBUG`.
 * The domain errors here attach the underlying failure as `cause` — a permission error behind a
 * failed close, a `SyntaxError` behind an invalid pattern — and before this it was constructed on
 * every failure and read by nobody.
 */
function failStep(error: unknown): void {
  core.debug(describeFailure(error));

  const message = error === null || error === undefined ? '' : errorMessage(error).trim();

  core.setFailed(message === '' ? UNKNOWN_ERROR : message);
}

export function runAction(body: () => Promise<void>): Promise<void>;
export function runAction(body: () => void): void;

/**
 * Runs the body of an action, failing the step with whatever it throws.
 *
 * Every action shares one failure path: an uncaught error fails the step with its message, and
 * nothing escapes as an unhandled rejection — which the runner reports as a crashed process rather
 * than as the failed check the workflow is waiting for.
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
