/**
 * Renders the reason something failed, without leaking a non-`Error` rejection as `[object Object]`.
 *
 * JavaScript allows throwing any value, and a rejected Octokit request, a `vm` timeout and a bare
 * `throw 'boom'` all reach an action's error path indistinguishably. Every one of them has to end up
 * as text in a job log, so the conversion belongs in one place rather than in each `catch`.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Preserves a failure as an `Error`, without assuming the thrower threw one.
 *
 * Used where the failure is carried onwards as a value — attached to a result, or as the `cause` of
 * a wrapping error — rather than immediately rendered to text.
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
