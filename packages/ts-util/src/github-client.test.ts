import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOctokit,
  DEFAULT_RETRY_POLICY,
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
});

describe('createOctokit', () => {
  const client = { hook: { wrap: vi.fn() } };

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
    const plugin = vi.mocked(github.getOctokit).mock.calls[0][2] as unknown as (octokit: typeof client) => void;
    plugin(client);

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
});

describe('DEFAULT_RETRY_POLICY', () => {
  it('bounds a single wait to one minute and retries a handful of times', () => {
    expect(DEFAULT_RETRY_POLICY.maxDelayMs).toBe(60_000);
    expect(DEFAULT_RETRY_POLICY.maxRetries).toBeGreaterThan(0);
    expect(DEFAULT_RETRY_POLICY.baseDelayMs).toBeGreaterThan(0);
  });
});
