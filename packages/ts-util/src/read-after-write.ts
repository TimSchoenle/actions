import * as core from '@actions/core';

import { hasStatus } from './github.js';

/**
 * How long a read waits for a resource the caller has just written to become readable.
 *
 * Deliberately separate from the shared Octokit's rate-limit retry: a 404 is a load-bearing answer
 * everywhere else — `resolveExists` and `resolveOptional` turn it into "does not exist" — so it must
 * never be retried client-wide. Only a caller that has just created the resource knows the 404 is a
 * lie, so this is opted into per request.
 *
 * It also lives in its own entry point rather than beside the rate-limit retry, so the actions that
 * import `actions-util/client` and never do a read-after-write do not carry this code in their bundle.
 */
export interface ReadAfterWritePolicy {
  /** How many times the read is repeated before the 404 is taken at face value. */
  maxRetries: number;
  /** Base of the exponential backoff between attempts. */
  baseDelayMs: number;
}

/**
 * Defaults covering GitHub's observed ref-replication lag.
 *
 * The waits are 0.5s, 1s, 2s and 4s — 7.5s in the worst case, and nothing at all in the overwhelmingly
 * common case where the first read already succeeds.
 */
export const DEFAULT_READ_AFTER_WRITE_POLICY: ReadAfterWritePolicy = {
  maxRetries: 4,
  baseDelayMs: 500,
};

/** GitHub's answer for a resource that does not exist — or that has not replicated yet. */
const NOT_FOUND = 404;

/** Injected in tests so they need neither a real clock nor real timers. */
const realSleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Runs a read of a resource the caller has just created, retrying while GitHub still answers 404.
 *
 * A write GitHub has acknowledged is not immediately visible to every read replica: a branch created
 * through `createRef` regularly 404s on a `getRef` issued a few hundred milliseconds later. The write
 * did happen, so the 404 is transient — and because this is a read, repeating it has no effect either
 * way.
 *
 * Retries only a 404, and only within the given budget; every other failure propagates untouched, and
 * a resource that is genuinely missing still fails once the budget is spent.
 *
 * @param what names the resource for the log line explaining the wait, e.g. `Branch 'main'`.
 */
export async function readAfterWrite<T>(
  perform: () => Promise<T>,
  what: string,
  policy: ReadAfterWritePolicy = DEFAULT_READ_AFTER_WRITE_POLICY,
  sleep: (milliseconds: number) => Promise<void> = realSleep,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await perform();
    } catch (error) {
      if (attempt >= policy.maxRetries || !hasStatus(error, NOT_FOUND)) {
        throw error;
      }

      const delayMs = policy.baseDelayMs * 2 ** attempt;
      core.info(
        `${what} is not readable yet (GitHub answered 404); retrying in ${delayMs}ms ` +
          `(attempt ${attempt + 1} of ${policy.maxRetries}).`,
      );
      await sleep(delayMs);
    }
  }
}
