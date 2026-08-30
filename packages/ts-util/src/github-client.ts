import * as core from '@actions/core';
import * as github from '@actions/github';

import { errorMessage } from './errors.js';

/**
 * How the shared Octokit rides out a request GitHub rejected for rate limiting.
 *
 * Two bounds, deliberately separate. `maxDelayMs` is a *per-attempt* ceiling: no single wait exceeds
 * it, and a limit whose reset lies further out is treated as un-waitable. `maxTotalDelayMs` bounds
 * what the attempts may cost *together*. Either one being reached is a decision to stop waiting and
 * fail — an exhausted hourly installation budget can be most of an hour from its reset, and parking a
 * runner on that is worse than failing and letting the deferred re-run sweep pick the work up once
 * the window has actually reopened.
 */
export interface RetryPolicy {
  /** How many times a rate-limited request is retried before its error is surfaced. */
  maxRetries: number;
  /** Base of the exponential backoff used when GitHub does not tell us how long to wait. */
  baseDelayMs: number;
  /** The longest any single wait may be. A required wait above this abandons the retries. */
  maxDelayMs: number;
  /**
   * The longest a single request may spend waiting across *all* of its attempts.
   *
   * `maxDelayMs` alone bounds no total: three retries at the per-attempt ceiling would idle a runner
   * for three times that ceiling without anything saying so. This is the bound an operator actually
   * budgets for, and the one that decides when a refusal stops being worth waiting on.
   */
  maxTotalDelayMs: number;
}

/**
 * Defaults tuned for GitHub Actions, where a job holds a runner for every second it waits.
 *
 * A secondary (abuse) rate limit clears in seconds to a few minutes, which the three-minute ceiling
 * rides out. A primary-limit reset tens of minutes away is deliberately *not* waited for, and the
 * five-minute total keeps three such waits from quietly compounding into a quarter-hour of idling:
 * failing fast and letting the work be re-run is cheaper than holding the runner.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 180_000,
  maxTotalDelayMs: 300_000,
};

/**
 * The ambient effects the retry loop depends on, injected so tests need neither a real clock nor real
 * timers to exercise it.
 */
export interface RetryClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  /**
   * A uniform draw from `[0, 1)`, used to jitter every wait.
   *
   * Injected rather than reached for directly so a test can pin the jitter and still assert on exact
   * delays; omitted, it falls back to `Math.random`.
   */
  random?(): number;
}

const REAL_CLOCK: RetryClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random: () => Math.random(),
};

/** The statuses GitHub uses to refuse a request for rate limiting; every retry decision starts here. */
const RATE_LIMIT_STATUSES = new Set([403, 429]);

/** Floor on any wait, so a reset already in the past becomes a brief pause rather than a busy loop. */
const MIN_DELAY_MS = 1_000;

/** Added to a reset wait to cover clock skew, so we never wake a hair before the window reopens. */
const RESET_BUFFER_MS = 1_000;

/**
 * The window a wait GitHub itself dictated is smeared across.
 *
 * A `Retry-After` or a reset epoch names one instant, and every job refused by the same installation
 * budget is handed that same instant — so without a spread the whole batch wakes on the same second
 * and collides again. The spread is only ever added: waking *before* the window reopens would
 * guarantee another refusal, so the dictated wait is a floor, never an average.
 */
const DICTATED_SPREAD_MS = 5_000;

/**
 * The `title` on the annotation written when a rate limit outlives the retries.
 *
 * A stable key, unlike the message text, so tooling that reacts to these failures — the deferred
 * re-run sweep in `scripts/rerun-rate-limited.ts` — can recognise one without matching on prose.
 */
export const RATE_LIMIT_ANNOTATION_TITLE = 'GitHub API rate limit';

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
 * Spreads a wait we chose ourselves across the whole interval below it ("full jitter").
 *
 * The backoff schedule is identical in every job, so an unjittered one has every job that lost the
 * same race retry on the same tick, and lose it again together. Drawing uniformly from `[0, delay]`
 * is what breaks that lockstep; the floor keeps the draw from becoming a busy loop.
 */
function withFullJitter(milliseconds: number, random: () => number): number {
  return Math.max(MIN_DELAY_MS, Math.round(random() * milliseconds));
}

/** Smears a wait GitHub dictated forwards only, never past the per-attempt ceiling. */
function withSpread(milliseconds: number, policy: RetryPolicy, random: () => number): number {
  return Math.min(milliseconds + Math.round(random() * DICTATED_SPREAD_MS), policy.maxDelayMs);
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

/** The backoff this loop picks for itself when GitHub named no wait, jittered across its interval. */
function chosenDelay(attempt: number, policy: RetryPolicy, random: () => number): number {
  return withFullJitter(backoffMs(attempt, policy), random);
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
 *
 * Whether to retry at all is decided on the *unjittered* wait, so the answer does not turn on a coin
 * flip; the jitter is applied only to the wait that decision keeps.
 */
export function rateLimitDelayMs(
  error: unknown,
  attempt: number,
  policy: RetryPolicy,
  nowMs: number,
  random: () => number = Math.random,
): number | undefined {
  if (!isRateLimitError(error)) {
    return undefined;
  }

  const status = httpStatus(error);
  const headers = httpHeaders(error);

  const retryAfterSeconds = nonNegativeInt(headers['retry-after']);
  if (retryAfterSeconds !== undefined) {
    const dictated = boundedDelay(retryAfterSeconds * 1_000, policy);

    return dictated === undefined ? undefined : withSpread(dictated, policy, random);
  }

  if (headers['x-ratelimit-remaining'] === '0') {
    const resetEpochSeconds = nonNegativeInt(headers['x-ratelimit-reset']);
    if (resetEpochSeconds !== undefined) {
      const dictated = boundedDelay(resetEpochSeconds * 1_000 - nowMs + RESET_BUFFER_MS, policy);

      return dictated === undefined ? undefined : withSpread(dictated, policy, random);
    }

    return chosenDelay(attempt, policy, random);
  }

  if (isGraphqlRateLimited(error) || isSecondaryRateLimit(error) || status === 429) {
    return chosenDelay(attempt, policy, random);
  }

  return undefined;
}

/** Renders a millisecond budget the way the log lines quote it. */
function asSeconds(milliseconds: number): number {
  return Math.ceil(milliseconds / 1_000);
}

/** Either the wait to serve before the next attempt, or the reason there will not be one. */
type RetryDecision = { delayMs: number } | { giveUp: string };

/**
 * Decides the fate of one rate-limited attempt, and names the bound that ended it.
 *
 * Three separate bounds can stop a retry, and an operator can only act on the one that actually
 * bit — "still refused after 3 retries" calls for cutting call volume, while "exceeds the total wait
 * budget" calls for a deferred re-run instead of a longer wait. The raw error names none of them.
 */
function decideRetry(
  error: unknown,
  attempt: number,
  waitedMs: number,
  policy: RetryPolicy,
  nowMs: number,
  random: () => number,
): RetryDecision {
  if (attempt >= policy.maxRetries) {
    return { giveUp: `it is still in force after ${policy.maxRetries} retries` };
  }

  const delayMs = rateLimitDelayMs(error, attempt, policy, nowMs, random);
  if (delayMs === undefined) {
    return { giveUp: `the wait it requires exceeds the ${asSeconds(policy.maxDelayMs)}s per-attempt ceiling` };
  }

  if (waitedMs + delayMs > policy.maxTotalDelayMs) {
    return { giveUp: `riding it out would exceed the ${asSeconds(policy.maxTotalDelayMs)}s total wait budget` };
  }

  return { delayMs };
}

/**
 * Names the rate limit a retry loop has given up on, under a stable annotation title.
 *
 * The raw error says only that GitHub refused the request; it never says that the refusal was ridden
 * out to the end of the policy, which is the part an operator can act on — a GraphQL refusal least of
 * all, since it reads as an ordinary response error. The title is what lets the deferred re-run sweep
 * tell this failure apart from every other way a job can go red, without matching on prose.
 */
function reportUnretried(error: unknown, reason: string): void {
  core.error(`GitHub API rate limit hit and not ridden out — ${reason}: ${errorMessage(error)}`, {
    title: RATE_LIMIT_ANNOTATION_TITLE,
  });
}

/**
 * Runs a request, retrying it while GitHub keeps refusing it for rate limiting.
 *
 * A rate-limited request is rejected *before* GitHub acts on it, so replaying one — even a mutation —
 * cannot double an effect; the only requests retried here are those that never ran.
 *
 * Every wait is jittered, because these actions do not run alone: a release batch puts dozens of jobs
 * on one installation budget, and an unjittered schedule has all of them retry on the same tick.
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
  const random = clock.random?.bind(clock) ?? Math.random;
  let waitedMs = 0;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await perform();
    } catch (error) {
      if (!owns(error)) {
        throw error;
      }

      const decision = decideRetry(error, attempt, waitedMs, policy, clock.now(), random);
      if ('giveUp' in decision) {
        reportUnretried(error, decision.giveUp);

        throw error;
      }

      waitedMs += decision.delayMs;
      core.info(
        `GitHub API rate limit hit (${errorMessage(error)}); retrying in ${asSeconds(decision.delayMs)}s ` +
          `(attempt ${attempt + 1} of ${policy.maxRetries}, ${asSeconds(waitedMs)}s of the ` +
          `${asSeconds(policy.maxTotalDelayMs)}s wait budget spent).`,
      );
      await clock.sleep(decision.delayMs);
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
