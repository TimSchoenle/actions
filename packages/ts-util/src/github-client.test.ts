import * as core from '@actions/core';
import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOctokit,
  DEFAULT_RETRY_POLICY,
  isRateLimitError,
  rateLimitDelayMs,
  requestWithRateLimitRetry,
  type RetryClock,
  type RetryPolicy,
} from './github-client.js';

vi.mock('@actions/github');
vi.mock('@actions/core');

const POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 60_000 };

/** Builds an object shaped like an Octokit `RequestError`. */
function httpError(
  status: number,
  { data, headers, message }: { data?: unknown; headers?: Record<string, string>; message?: string } = {},
): unknown {
  return Object.assign(new Error(message ?? `HTTP ${status}`), {
    status,
    response: { data, headers },
  });
}

/**
 * Builds an object shaped like `@octokit/graphql`'s `GraphqlResponseError`: no `status`, the response
 * headers hung directly off the error, and the GraphQL `errors` payload at the top level.
 */
function graphqlError(
  message: string,
  { headers, type }: { headers?: Record<string, string>; type?: string } = {},
): unknown {
  const errors = [{ message, type }];

  return Object.assign(new Error(`Request failed due to following response errors:\n - ${message}`), {
    errors,
    headers: headers ?? {},
    response: { data: null, errors },
  });
}

/** A clock that never advances and records every requested sleep instead of waiting. */
function fakeClock(nowMs = 0): RetryClock & { sleeps: number[] } {
  const sleeps: number[] = [];

  return {
    sleeps,
    now: () => nowMs,
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);

      return Promise.resolve();
    },
  };
}

describe('rateLimitDelayMs', () => {
  it('does not retry a non-HTTP error', () => {
    expect(rateLimitDelayMs(new Error('socket hang up'), 0, POLICY, 0)).toBeUndefined();
  });

  it.each([200, 404, 422, 500, 502])('does not retry status %i', (status) => {
    expect(rateLimitDelayMs(httpError(status), 0, POLICY, 0)).toBeUndefined();
  });

  it('does not retry a 403 that carries no rate-limit signal', () => {
    const error = httpError(403, { message: 'Resource not accessible by integration' });

    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBeUndefined();
  });

  it('honours a Retry-After header', () => {
    const error = httpError(403, { headers: { 'retry-after': '5' } });

    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBe(5_000);
  });

  it('reads headers carried directly on the error, not only under response', () => {
    const error = Object.assign(new Error('secondary'), { status: 429, headers: { 'retry-after': '3' } });

    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBe(3_000);
  });

  it('floors a zero-second Retry-After to the minimum delay', () => {
    const error = httpError(429, { headers: { 'retry-after': '0' } });

    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBe(1_000);
  });

  it('abandons retries when Retry-After exceeds the ceiling', () => {
    const error = httpError(403, { headers: { 'retry-after': '120' } });

    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBeUndefined();
  });

  it('waits for the reset when the primary budget is exhausted', () => {
    const nowMs = 1_000_000;
    const resetEpochSeconds = nowMs / 1_000 + 10;
    const error = httpError(403, {
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetEpochSeconds) },
    });

    // 10s until reset, plus the 1s skew buffer.
    expect(rateLimitDelayMs(error, 0, POLICY, nowMs)).toBe(11_000);
  });

  it('floors a reset already in the past to the minimum delay', () => {
    const error = httpError(403, {
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' },
    });

    expect(rateLimitDelayMs(error, 0, POLICY, 10_000_000)).toBe(1_000);
  });

  it('abandons retries when the reset is further out than the ceiling', () => {
    const nowMs = 0;
    const error = httpError(403, {
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3600' },
    });

    expect(rateLimitDelayMs(error, 0, POLICY, nowMs)).toBeUndefined();
  });

  it('backs off exponentially when the budget is spent but no reset is given', () => {
    const error = httpError(403, { headers: { 'x-ratelimit-remaining': '0' } });

    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBe(1_000);
    expect(rateLimitDelayMs(error, 1, POLICY, 0)).toBe(2_000);
    expect(rateLimitDelayMs(error, 2, POLICY, 0)).toBe(4_000);
  });

  it('backs off on a secondary rate limit that arrives without a Retry-After', () => {
    const error = httpError(403, { data: { message: 'You have exceeded a secondary rate limit' } });

    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBe(1_000);
    expect(rateLimitDelayMs(error, 3, POLICY, 0)).toBe(8_000);
  });

  it('backs off on a bare 429 with no headers', () => {
    expect(rateLimitDelayMs(httpError(429), 0, POLICY, 0)).toBe(1_000);
  });

  it('caps exponential backoff at the ceiling', () => {
    const error = httpError(429);

    expect(rateLimitDelayMs(error, 20, POLICY, 0)).toBe(POLICY.maxDelayMs);
  });

  // GitHub answers a rate-limited GraphQL call with HTTP 200 and an `errors` payload, so none of the
  // status-based signals above apply — yet every write these actions perform goes through GraphQL.
  it('backs off on a GraphQL rate-limit payload that carries no status', () => {
    const error = graphqlError('API rate limit already exceeded for installation ID 103406604.');

    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBe(1_000);
    expect(rateLimitDelayMs(error, 2, POLICY, 0)).toBe(4_000);
  });

  it('recognises a RATE_LIMITED entry whose message does not say so', () => {
    const error = graphqlError('You have exceeded your quota.', { type: 'RATE_LIMITED' });

    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBe(1_000);
  });

  it('waits for the reset carried on a GraphQL rate-limit error', () => {
    const error = graphqlError('API rate limit exceeded.', {
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '10' },
    });

    // 10s until reset, plus the 1s skew buffer.
    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBe(11_000);
  });

  it('does not retry a GraphQL error that is not a rate limit', () => {
    const error = graphqlError('Could not resolve to a Repository with the name "o/r".');

    expect(rateLimitDelayMs(error, 0, POLICY, 0)).toBeUndefined();
  });
});

describe('isRateLimitError', () => {
  it.each([
    ['a 403 with a spent budget', httpError(403, { headers: { 'x-ratelimit-remaining': '0' } })],
    ['a 429', httpError(429)],
    ['a GraphQL rate-limit payload', graphqlError('API rate limit exceeded.')],
  ])('recognises %s', (_label, error) => {
    expect(isRateLimitError(error)).toBe(true);
  });

  it.each([
    ['a plain error', new Error('socket hang up')],
    ['a 404', httpError(404)],
    ['a GraphQL validation error', graphqlError('Field "oid" does not exist.')],
    ['an error whose errors field is not a list', Object.assign(new Error('odd'), { errors: 'rate limit' })],
  ])('does not mistake %s for one', (_label, error) => {
    expect(isRateLimitError(error)).toBe(false);
  });
});

describe('requestWithRateLimitRetry', () => {
  it('returns the result without sleeping when the request succeeds', async () => {
    const clock = fakeClock();
    const perform = vi.fn().mockResolvedValue('ok');

    await expect(requestWithRateLimitRetry(perform, POLICY, clock)).resolves.toBe('ok');
    expect(perform).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('retries after the computed delay, then returns the eventual result', async () => {
    const clock = fakeClock();
    const perform = vi
      .fn()
      .mockRejectedValueOnce(httpError(403, { headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce('recovered');

    await expect(requestWithRateLimitRetry(perform, POLICY, clock)).resolves.toBe('recovered');
    expect(perform).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toEqual([2_000]);
  });

  it('gives up after maxRetries and surfaces the last error', async () => {
    const clock = fakeClock();
    const error = httpError(429, { headers: { 'retry-after': '1' } });
    const perform = vi.fn().mockRejectedValue(error);

    await expect(requestWithRateLimitRetry(perform, POLICY, clock)).rejects.toBe(error);
    expect(perform).toHaveBeenCalledTimes(POLICY.maxRetries + 1);
    expect(clock.sleeps).toHaveLength(POLICY.maxRetries);
  });

  it('does not retry an error that is not a rate limit', async () => {
    const clock = fakeClock();
    const error = httpError(500);
    const perform = vi.fn().mockRejectedValue(error);

    await expect(requestWithRateLimitRetry(perform, POLICY, clock)).rejects.toBe(error);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('does not retry when the required wait exceeds the ceiling', async () => {
    const clock = fakeClock();
    const error = httpError(403, { headers: { 'retry-after': '600' } });
    const perform = vi.fn().mockRejectedValue(error);

    await expect(requestWithRateLimitRetry(perform, POLICY, clock)).rejects.toBe(error);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('retries a rate-limited GraphQL response, which carries no status at all', async () => {
    const clock = fakeClock();
    const perform = vi
      .fn()
      .mockRejectedValueOnce(graphqlError('API rate limit already exceeded for installation ID 1.'))
      .mockResolvedValueOnce('committed');

    await expect(requestWithRateLimitRetry(perform, POLICY, clock)).resolves.toBe('committed');
    expect(perform).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toEqual([1_000]);
  });

  it('warns that a rate limit outlived the ceiling, which the raw error does not say', async () => {
    vi.mocked(core.warning).mockClear();
    const error = graphqlError('API rate limit already exceeded for installation ID 1.', {
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3600' },
    });

    await expect(requestWithRateLimitRetry(vi.fn().mockRejectedValue(error), POLICY, fakeClock())).rejects.toBe(error);
    expect(vi.mocked(core.warning).mock.calls[0][0]).toContain('rate limit');
  });

  it('stays silent about a failure that is not a rate limit', async () => {
    vi.mocked(core.warning).mockClear();
    const error = httpError(500);

    await expect(requestWithRateLimitRetry(vi.fn().mockRejectedValue(error), POLICY, fakeClock())).rejects.toBe(error);
    expect(core.warning).not.toHaveBeenCalled();
  });
});

describe('createOctokit', () => {
  const endpoint = { DEFAULTS: {} };
  const graphql = Object.assign(vi.fn(), { defaults: vi.fn(), endpoint });
  const client = { graphql, hook: { wrap: vi.fn() } };

  /** Runs the plugin `createOctokit` handed to the mocked `getOctokit` against the fake client. */
  function applyPlugin(): { graphql: typeof graphql } {
    const plugin = vi.mocked(github.getOctokit).mock.calls[0][2] as unknown as (octokit: typeof client) => {
      graphql: typeof graphql;
    };

    return plugin(client);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(github.getOctokit).mockReturnValue(client as unknown as ReturnType<typeof github.getOctokit>);
  });

  it('builds the client through getOctokit with a plugin', () => {
    const octokit = createOctokit('token');

    expect(octokit).toBe(client);
    const [token, options, plugin] = vi.mocked(github.getOctokit).mock.calls[0];
    expect(token).toBe('token');
    expect(options).toBeUndefined();
    expect(plugin).toBeInstanceOf(Function);
  });

  it('registers a request hook that retries rate-limited requests', async () => {
    const clock = fakeClock();
    createOctokit('token', { baseDelayMs: 500, maxDelayMs: 10_000, maxRetries: 1 }, clock);

    // getOctokit is mocked, so the plugin never ran against a real client; run it against ours.
    applyPlugin();

    expect(client.hook.wrap).toHaveBeenCalledWith('request', expect.any(Function));
    const wrapper = client.hook.wrap.mock.calls[0][1] as (
      request: (options: unknown) => Promise<unknown>,
      options: unknown,
    ) => Promise<unknown>;

    const request = vi
      .fn()
      .mockRejectedValueOnce(httpError(403, { headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce('done');
    const options = { url: '/repos/o/r' };

    await expect(wrapper(request, options)).resolves.toBe('done');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(options);
    expect(clock.sleeps).toEqual([1_000]);
  });

  // The request hook cannot see this: `@octokit/graphql` raises the error only after the 200 response
  // has already travelled back through the hook.
  it('replaces graphql with one that retries a rate-limited GraphQL response', async () => {
    const clock = fakeClock();
    createOctokit('token', { baseDelayMs: 500, maxDelayMs: 10_000, maxRetries: 1 }, clock);
    const retrying = applyPlugin().graphql;

    graphql
      .mockRejectedValueOnce(
        graphqlError('API rate limit already exceeded for installation ID 1.', {
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3' },
        }),
      )
      .mockResolvedValueOnce({ createCommitOnBranch: null });

    await expect(retrying('mutation Commit {}', { input: {} })).resolves.toEqual({ createCommitOnBranch: null });
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql).toHaveBeenLastCalledWith('mutation Commit {}', { input: {} });
    // 3s until the reset, plus the 1s skew buffer.
    expect(clock.sleeps).toEqual([4_000]);
  });

  it('leaves an HTTP-level rate limit to the request hook instead of retrying it a second time', async () => {
    const clock = fakeClock();
    createOctokit('token', { baseDelayMs: 500, maxDelayMs: 10_000, maxRetries: 1 }, clock);
    const retrying = applyPlugin().graphql;

    const error = httpError(403, { headers: { 'retry-after': '1' } });
    graphql.mockRejectedValueOnce(error);

    await expect(retrying('query {}')).rejects.toBe(error);
    expect(graphql).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('keeps the graphql endpoint and gives derived clients the same retry', async () => {
    const clock = fakeClock();
    createOctokit('token', { baseDelayMs: 500, maxDelayMs: 10_000, maxRetries: 1 }, clock);
    const retrying = applyPlugin().graphql;

    expect(retrying.endpoint).toBe(endpoint);

    const derivedGraphql = vi
      .fn()
      .mockRejectedValueOnce(graphqlError('API rate limit exceeded.'))
      .mockResolvedValueOnce('derived');
    graphql.defaults.mockReturnValue(derivedGraphql);

    const derived = retrying.defaults({ baseUrl: 'https://ghe.example/api/graphql' });

    await expect(derived('query {}')).resolves.toBe('derived');
    expect(derivedGraphql).toHaveBeenCalledTimes(2);
  });
});

describe('DEFAULT_RETRY_POLICY', () => {
  it('is a bounded, self-consistent policy', () => {
    expect(DEFAULT_RETRY_POLICY.maxRetries).toBeGreaterThan(0);
    expect(DEFAULT_RETRY_POLICY.baseDelayMs).toBeGreaterThan(0);
    // The ceiling must sit at or above the base, or the first backoff would already be clipped.
    expect(DEFAULT_RETRY_POLICY.maxDelayMs).toBeGreaterThanOrEqual(DEFAULT_RETRY_POLICY.baseDelayMs);
    expect(Number.isFinite(DEFAULT_RETRY_POLICY.maxDelayMs)).toBe(true);
  });
});
