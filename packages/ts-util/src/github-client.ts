import * as core from '@actions/core';
import * as github from '@actions/github';

import { errorMessage } from './errors.js';

/**
 * How the shared Octokit rides out a request GitHub rejected for rate limiting.
 *
 * `maxDelayMs` is a *per-attempt* ceiling, not a total budget: no single wait exceeds it, and a limit
 * whose reset lies further out than the ceiling is treated as un-waitable — the error propagates
 * rather than parking a billed Actions runner for minutes on a reset it cannot afford to wait for.
 */
export interface RetryPolicy {
  /** How many times a rate-limited request is retried before its error is surfaced. */
  maxRetries: number;
  /** Base of the exponential backoff used when GitHub does not tell us how long to wait. */
  baseDelayMs: number;
  /** The longest any single wait may be. A required wait above this abandons the retries. */
  maxDelayMs: number;
}

/**
 * Defaults tuned for GitHub Actions, where a job is billed for every second it waits.
 *
 * A secondary (abuse) rate limit clears in seconds to about a minute, so the one-minute ceiling rides
 * out the common case. A primary-limit reset that is tens of minutes away is deliberately *not*
 * waited for: failing fast and letting the workflow be re-run is cheaper than idling the runner.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 180_000,
};

/**
 * The ambient effects the retry loop depends on, injected so tests need neither a real clock nor real
 * timers to exercise it.
 */
export interface RetryClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

const REAL_CLOCK: RetryClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/** The statuses GitHub uses to refuse a request for rate limiting; every retry decision starts here. */
const RATE_LIMIT_STATUSES = new Set([403, 429]);

/** Floor on any wait, so a reset already in the past becomes a brief pause rather than a busy loop. */
const MIN_DELAY_MS = 1_000;

/** Added to a reset wait to cover clock skew, so we never wake a hair before the window reopens. */
const RESET_BUFFER_MS = 1_000;

/** The subset of an Octokit `RequestError` this module reads, without depending on its exact type. */
interface HttpErrorShape {
  status?: unknown;
  response?: { data?: unknown; headers?: unknown };
  headers?: unknown;
}

function asHttpError(error: unknown): HttpErrorShape | undefined {
  return typeof error === 'object' && error !== null ? (error as HttpErrorShape) : undefined;
}

function httpStatus(error: unknown): number | undefined {
  const status = asHttpError(error)?.status;

  return typeof status === 'number' ? status : undefined;
}

/**
 * Extracts the response headers, keyed lower-case.
 *
 * Octokit already lower-cases them, but normalising here keeps the reader independent of that and of
 * whether the error carries them on `response.headers` or directly on `headers`.
 */
function httpHeaders(error: unknown): Record<string, string> {
  const shape = asHttpError(error);
  const raw = shape?.response?.headers ?? shape?.headers;

  if (typeof raw !== 'object' || raw === null) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number') {
      headers[key.toLowerCase()] = String(value);
    }
  }

  return headers;
}

/** Parses a header that must be a non-negative integer (seconds or an epoch), else `undefined`. */
function nonNegativeInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Recognises a secondary (abuse) rate limit that arrived without a `Retry-After` header.
 *
 * These are told apart from an ordinary 403 by their message alone, so a permission error is never
 * mistaken for something worth retrying.
 */
function isSecondaryRateLimit(error: unknown): boolean {
  const data = asHttpError(error)?.response?.data;
  const dataMessage =
    typeof data === 'object' && data !== null && typeof (data as { message?: unknown }).message === 'string'
      ? (data as { message: string }).message
      : '';
  const text = `${errorMessage(error)} ${dataMessage}`.toLowerCase();

  return text.includes('secondary rate limit') || text.includes('abuse');
}

/** Exponential backoff, capped at the policy ceiling. */
function backoffMs(attempt: number, policy: RetryPolicy): number {
  return Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
}

/**
 * Bounds a computed wait to the policy: a wait longer than the ceiling returns `undefined` (abandon
 * the retries); anything shorter is floored to {@link MIN_DELAY_MS}.
 */
function boundedDelay(milliseconds: number, policy: RetryPolicy): number | undefined {
  if (milliseconds > policy.maxDelayMs) {
    return undefined;
  }

  return Math.max(milliseconds, MIN_DELAY_MS);
}

/**
 * Decides how long to wait before retrying a failed request, or `undefined` when it must not be
 * retried — either because the failure is not a rate limit, or because the wait it demands exceeds
 * the policy ceiling.
 *
 * The signals are read in order of authority:
 *  1. `Retry-After` — GitHub stating the exact wait (secondary limits, and any explicit header).
 *  2. `x-ratelimit-remaining: 0` with `x-ratelimit-reset` — the primary budget is spent; wait for the
 *     window to reopen.
 *  3. A secondary-limit message, or a bare 429 — no time was given, so back off exponentially.
 * A 403 carrying none of these is a permission or availability error, which retrying cannot mend.
 */
export function rateLimitDelayMs(
  error: unknown,
  attempt: number,
  policy: RetryPolicy,
  nowMs: number,
): number | undefined {
  const status = httpStatus(error);
  if (status === undefined || !RATE_LIMIT_STATUSES.has(status)) {
    return undefined;
  }

  const headers = httpHeaders(error);

  const retryAfterSeconds = nonNegativeInt(headers['retry-after']);
  if (retryAfterSeconds !== undefined) {
    return boundedDelay(retryAfterSeconds * 1_000, policy);
  }

  if (headers['x-ratelimit-remaining'] === '0') {
    const resetEpochSeconds = nonNegativeInt(headers['x-ratelimit-reset']);
    if (resetEpochSeconds !== undefined) {
      return boundedDelay(resetEpochSeconds * 1_000 - nowMs + RESET_BUFFER_MS, policy);
    }

    return boundedDelay(backoffMs(attempt, policy), policy);
  }

  if (isSecondaryRateLimit(error) || status === 429) {
    return boundedDelay(backoffMs(attempt, policy), policy);
  }

  return undefined;
}

/**
 * Runs a request, retrying it while GitHub keeps refusing it for rate limiting.
 *
 * A rate-limited request is rejected *before* GitHub acts on it, so replaying one — even a mutation —
 * cannot double an effect; the only requests retried here are those that never ran.
 */
export async function requestWithRateLimitRetry<T>(
  perform: () => Promise<T>,
  policy: RetryPolicy,
  clock: RetryClock = REAL_CLOCK,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await perform();
    } catch (error) {
      const delayMs = attempt < policy.maxRetries ? rateLimitDelayMs(error, attempt, policy, clock.now()) : undefined;
      if (delayMs === undefined) {
        throw error;
      }

      core.info(
        `GitHub API rate limit hit (${errorMessage(error)}); retrying in ${Math.ceil(delayMs / 1_000)}s ` +
          `(attempt ${attempt + 1} of ${policy.maxRetries}).`,
      );
      await clock.sleep(delayMs);
    }
  }
}

/**
 * Just the hook surface the retry plugin touches, borrowed from the real Octokit type so the wrapped
 * `request` and its result stay precisely typed rather than widened to `unknown` — and so the plugin
 * remains assignable to `getOctokit`'s plugin parameter.
 */
type HookableOctokit = Pick<ReturnType<typeof github.getOctokit>, 'hook'>;

/**
 * Binds an Octokit instance to a rate-limit retry policy.
 *
 * Delivered as an Octokit plugin rather than a post-construction tweak for two reasons: it wraps
 * `request`, through which Octokit routes both REST and GraphQL, so one seam covers every call; and
 * because `getOctokit` runs plugins only on a real instance, a test that mocks `getOctokit` never
 * reaches the wrap — the retry is exercised directly through {@link requestWithRateLimitRetry}.
 */
function rateLimitRetryPlugin(policy: RetryPolicy, clock: RetryClock) {
  return (octokit: HookableOctokit): void => {
    octokit.hook.wrap('request', (request, options) =>
      requestWithRateLimitRetry(() => Promise.resolve(request(options)), policy, clock),
    );
  };
}

/**
 * Creates an Octokit that retries requests GitHub refuses for rate limiting, per {@link RetryPolicy}.
 *
 * This is the only Octokit factory the actions use, so the retry behaviour is defined in one place
 * and cannot drift between adapters. `overrides` merge onto {@link DEFAULT_RETRY_POLICY}.
 */
export function createOctokit(
  token: string,
  overrides: Partial<RetryPolicy> = {},
  clock: RetryClock = REAL_CLOCK,
): ReturnType<typeof github.getOctokit> {
  const policy = { ...DEFAULT_RETRY_POLICY, ...overrides };

  return github.getOctokit(token, undefined, rateLimitRetryPlugin(policy, clock));
}
