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

/** Reads the top-level `errors` array a `GraphqlResponseError` carries, or an empty list. */
function graphqlErrors(error: unknown): unknown[] {
  if (typeof error !== 'object' || error === null) {
    return [];
  }

  const { errors } = error as { errors?: unknown };

  return Array.isArray(errors) ? errors : [];
}

/** The `type` GitHub puts on a GraphQL error entry it rejected for rate limiting. */
const GRAPHQL_RATE_LIMITED_TYPE = 'RATE_LIMITED';

/** Matches the wording GitHub uses for a rate-limit refusal, primary and secondary alike. */
const RATE_LIMIT_MESSAGE = /rate limit/i;

/**
 * Recognises a GraphQL request GitHub refused for rate limiting.
 *
 * The GraphQL API answers such a refusal with HTTP **200** and an `errors` payload, so there is no
 * status to classify by: `@octokit/graphql` turns that payload into a `GraphqlResponseError` that
 * carries the response headers but none of the HTTP signals the rest of this module reads. Every
 * write these actions perform — commits, branches, pull requests — goes through GraphQL, so this is
 * the path that matters most, not an edge case.
 */
function isGraphqlRateLimited(error: unknown): boolean {
  return graphqlErrors(error).some((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }

    const { message, type } = entry as { message?: unknown; type?: unknown };

    return type === GRAPHQL_RATE_LIMITED_TYPE || (typeof message === 'string' && RATE_LIMIT_MESSAGE.test(message));
  });
}

/** Whether GitHub refused this request for rate limiting, over either the REST or the GraphQL path. */
export function isRateLimitError(error: unknown): boolean {
  const status = httpStatus(error);

  return (status !== undefined && RATE_LIMIT_STATUSES.has(status)) || isGraphqlRateLimited(error);
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
 *  3. A GraphQL rate-limit payload, a secondary-limit message, or a bare 429 — no time was given, so
 *     back off exponentially.
 * A 403 carrying none of these is a permission or availability error, which retrying cannot mend.
 */
export function rateLimitDelayMs(
  error: unknown,
  attempt: number,
  policy: RetryPolicy,
  nowMs: number,
): number | undefined {
  if (!isRateLimitError(error)) {
    return undefined;
  }

  const status = httpStatus(error);
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

  if (isGraphqlRateLimited(error) || isSecondaryRateLimit(error) || status === 429) {
    return boundedDelay(backoffMs(attempt, policy), policy);
  }

  return undefined;
}

/**
 * Names the rate limit a retry loop is about to give up on.
 *
 * The raw error says only that GitHub refused the request; it never says that the refusal was ridden
 * out to the end of the policy, which is the part an operator can act on — a GraphQL refusal least of
 * all, since it reads as an ordinary response error.
 */
function warnUnretried(error: unknown, attempt: number, policy: RetryPolicy, owns: (error: unknown) => boolean): void {
  if (!owns(error)) {
    return;
  }

  const reason =
    attempt >= policy.maxRetries
      ? `it is still in force after ${policy.maxRetries} retries`
      : `the wait it requires exceeds the ${Math.ceil(policy.maxDelayMs / 1_000)}s ceiling`;

  core.warning(`GitHub API rate limit hit and not ridden out — ${reason}: ${errorMessage(error)}`);
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
  /**
   * Narrows which failures this loop is responsible for. It exists so the two seams in
   * {@link rateLimitRetryPlugin} cannot both retry the same error: the GraphQL seam sits on top of
   * the retried `request` hook, so everything it sees except an HTTP 200 rate-limit payload has
   * already had its retries spent underneath.
   */
  owns: (error: unknown) => boolean = isRateLimitError,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await perform();
    } catch (error) {
      const delayMs =
        owns(error) && attempt < policy.maxRetries ? rateLimitDelayMs(error, attempt, policy, clock.now()) : undefined;

      if (delayMs === undefined) {
        warnUnretried(error, attempt, policy, owns);

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
 * Just the surface the retry plugin touches, borrowed from the real Octokit type so the wrapped
 * `request` and `graphql` stay precisely typed rather than widened to `unknown` — and so the plugin
 * remains assignable to `getOctokit`'s plugin parameter.
 */
type RetryableOctokit = Pick<ReturnType<typeof github.getOctokit>, 'graphql' | 'hook'>;

/** The `graphql` callable Octokit exposes, together with the two properties it carries. */
type GraphqlApi = RetryableOctokit['graphql'];

/**
 * Rebuilds a `graphql` callable so the rate limits its transport cannot see are retried, preserving
 * the properties the callable carries.
 *
 * Only HTTP 200 rate-limit payloads are this seam's to retry; an HTTP-level rate limit has already
 * been through the retried `request` hook below it, and retrying it again here would multiply both
 * the attempts and the waiting.
 *
 * `defaults` is wrapped rather than passed through, so a derived client keeps the retry instead of
 * silently dropping back to the bare API.
 */
function withGraphqlRetry(graphqlApi: GraphqlApi, policy: RetryPolicy, clock: RetryClock): GraphqlApi {
  const call = (...parameters: Parameters<GraphqlApi>): ReturnType<GraphqlApi> =>
    requestWithRateLimitRetry(() => graphqlApi(...parameters), policy, clock, isGraphqlRateLimited);

  return Object.assign(call as GraphqlApi, {
    defaults: (newDefaults: Parameters<GraphqlApi['defaults']>[0]): GraphqlApi =>
      withGraphqlRetry(graphqlApi.defaults(newDefaults), policy, clock),
    endpoint: graphqlApi.endpoint,
  });
}

/**
 * Binds an Octokit instance to a rate-limit retry policy.
 *
 * Delivered as an Octokit plugin rather than a post-construction tweak because `getOctokit` accepts
 * one, and because Octokit merges a plugin's return value onto the instance — which is the only
 * supported way to reach the second of the two seams this needs:
 *
 *  * `request` covers everything that fails as an HTTP error, REST and GraphQL transport alike;
 *  * `graphql` covers what `request` structurally cannot. GitHub answers a rate-limited GraphQL call
 *    with HTTP 200 and an `errors` payload, and `@octokit/graphql` raises that as an error only
 *    *after* the request hook has already returned the successful response — so a rate-limited
 *    mutation never reached the retry at all until it was wrapped here.
 *
 * `getOctokit` runs plugins only on a real instance, so a test that mocks it never reaches either
 * wrap; both are exercised directly through {@link requestWithRateLimitRetry}.
 */
function rateLimitRetryPlugin(policy: RetryPolicy, clock: RetryClock) {
  return (octokit: RetryableOctokit): { graphql: GraphqlApi } => {
    octokit.hook.wrap('request', (request, options) =>
      requestWithRateLimitRetry(() => Promise.resolve(request(options)), policy, clock),
    );

    return { graphql: withGraphqlRetry(octokit.graphql, policy, clock) };
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
