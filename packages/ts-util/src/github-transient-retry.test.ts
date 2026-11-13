import * as core from './core.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TRANSIENT_RETRY_POLICY,
  isReadOnlyGraphqlDocument,
  isReplayableRequest,
  isTransientServerError,
  requestWithTransientRetry,
  transientDelayMs,
  type TransientRetryClock,
  type TransientRetryPolicy,
} from './github-transient-retry.js';

vi.mock('./core.js');

const POLICY: TransientRetryPolicy = { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 8_000 };

const NO_JITTER = () => 0;
const FULL_JITTER = () => 1;

/** The HTML page GitHub's edge proxy serves with a 502, which Octokit uses as the error message. */
const BAD_GATEWAY_PAGE =
  '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n</body>\r\n</html>';

/** Builds an object shaped like an Octokit `RequestError` that carries a response. */
function httpError(status: number, message = `HTTP ${status}`): unknown {
  return Object.assign(new Error(message), { status, response: { data: message, headers: {} } });
}

/** Builds an object shaped like the `RequestError` Octokit raises when fetch itself fails. */
function networkError(message: string): unknown {
  return Object.assign(new Error(message), { status: 500 });
}

function fakeClock(random: () => number = NO_JITTER): TransientRetryClock & { sleeps: number[] } {
  const sleeps: number[] = [];

  return {
    sleeps,
    random,
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);

      return Promise.resolve();
    },
  };
}

describe('isTransientServerError', () => {
  it.each([500, 502, 503, 504])('treats HTTP %i as transient', (status) => {
    expect(isTransientServerError(httpError(status))).toBe(true);
  });

  it('treats a failed fetch, which Octokit reports as a 500 without a response, as transient', () => {
    expect(isTransientServerError(networkError('fetch failed'))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422, 429, 501])('does not treat HTTP %i as transient', (status) => {
    expect(isTransientServerError(httpError(status))).toBe(false);
  });

  it('does not treat a GraphQL response error, which has no status, as transient', () => {
    expect(isTransientServerError(Object.assign(new Error('boom'), { errors: [{ message: 'boom' }] }))).toBe(false);
  });

  it.each([undefined, null, 'string', 502])('rejects the non-object %p', (value) => {
    expect(isTransientServerError(value)).toBe(false);
  });
});

describe('isReadOnlyGraphqlDocument', () => {
  it.each([
    'query OpenPullRequests($owner: String!) { repository(owner: $owner) { id } }',
    '{ viewer { login } }',
    'query A { viewer { login } } fragment F on User { login }',
  ])('accepts the read-only document %s', (document) => {
    expect(isReadOnlyGraphqlDocument(document)).toBe(true);
  });

  it.each([
    'mutation Commit($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }',
    'query A { viewer { login } }\nmutation B { addStar(input: {}) { clientMutationId } }',
    'subscription S { event }',
    '  MUTATION weird { x }',
  ])('rejects the document %s, which can write', (document) => {
    expect(isReadOnlyGraphqlDocument(document)).toBe(false);
  });

  it('errs towards not retrying when the word appears only in a comment', () => {
    expect(isReadOnlyGraphqlDocument('# no mutation here\nquery { viewer { login } }')).toBe(false);
  });
});

describe('isReplayableRequest', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('replays a REST %s', (method) => {
    expect(isReplayableRequest({ method, url: '/repos/{owner}/{repo}/pulls/{pull_number}' })).toBe(true);
  });

  it('treats a request without a method as the GET Octokit defaults to', () => {
    expect(isReplayableRequest({ url: '/repos/o/r' })).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('never replays a REST %s', (method) => {
    expect(isReplayableRequest({ method, url: '/repos/{owner}/{repo}/pulls/{pull_number}/update-branch' })).toBe(false);
  });

  it('replays a GraphQL query', () => {
    expect(isReplayableRequest({ method: 'POST', query: 'query { viewer { login } }', url: '/graphql' })).toBe(true);
  });

  it('replays a GraphQL query sent to an absolute GHES endpoint', () => {
    expect(
      isReplayableRequest({
        method: 'POST',
        query: 'query { viewer { login } }',
        url: 'https://ghe.example/api/graphql',
      }),
    ).toBe(true);
  });

  it('never replays a GraphQL mutation', () => {
    expect(
      isReplayableRequest({
        method: 'POST',
        query: 'mutation { addStar(input: {}) { clientMutationId } }',
        url: '/graphql',
      }),
    ).toBe(false);
  });

  it('never replays a POST to /graphql that carries no document it can inspect', () => {
    expect(isReplayableRequest({ method: 'POST', url: '/graphql' })).toBe(false);
  });

  it('never replays a POST whose URL merely contains graphql', () => {
    expect(isReplayableRequest({ method: 'POST', query: 'query { a }', url: '/repos/o/graphql-tools/issues' })).toBe(
      false,
    );
  });

  it.each([undefined, null, 'GET'])('rejects the non-object %p', (value) => {
    expect(isReplayableRequest(value)).toBe(false);
  });

  it('never replays a POST whose URL is not a string', () => {
    expect(isReplayableRequest({ method: 'POST', query: 'query { a }', url: undefined })).toBe(false);
  });
});

describe('transientDelayMs', () => {
  it('doubles from the base delay', () => {
    expect([0, 1, 2].map((attempt) => transientDelayMs(attempt, POLICY, NO_JITTER))).toEqual([1_000, 2_000, 4_000]);
  });

  it('adds up to one base delay of jitter, forwards only', () => {
    expect(transientDelayMs(0, POLICY, FULL_JITTER)).toBe(2_000);
  });

  it('never exceeds the ceiling, jitter included', () => {
    expect(transientDelayMs(10, POLICY, FULL_JITTER)).toBe(POLICY.maxDelayMs);
  });
});

describe('requestWithTransientRetry', () => {
  beforeEach(() => {
    vi.mocked(core.info).mockClear();
  });

  it('returns the result without sleeping when the request succeeds', async () => {
    const clock = fakeClock();
    const perform = vi.fn().mockResolvedValue('ok');

    await expect(requestWithTransientRetry(perform, POLICY, clock)).resolves.toBe('ok');
    expect(perform).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('retries a 502 and returns the eventual result', async () => {
    const clock = fakeClock();
    const perform = vi
      .fn()
      .mockRejectedValueOnce(httpError(502, BAD_GATEWAY_PAGE))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce('recovered');

    await expect(requestWithTransientRetry(perform, POLICY, clock)).resolves.toBe('recovered');
    expect(perform).toHaveBeenCalledTimes(3);
    expect(clock.sleeps).toEqual([1_000, 2_000]);
  });

  it('logs the status rather than the HTML error page', async () => {
    const perform = vi.fn().mockRejectedValueOnce(httpError(502, BAD_GATEWAY_PAGE)).mockResolvedValueOnce('ok');

    await requestWithTransientRetry(perform, POLICY, fakeClock());

    const [message] = vi.mocked(core.info).mock.calls[0];
    expect(message).toContain('HTTP 502');
    expect(message).not.toContain('<html>');
    expect(message).toContain('attempt 1 of 3');
  });

  it('logs the first line of the cause when there was no response at all', async () => {
    const perform = vi
      .fn()
      .mockRejectedValueOnce(networkError('read ECONNRESET\n    at TLSWrap.onStreamRead'))
      .mockResolvedValueOnce('ok');

    await requestWithTransientRetry(perform, POLICY, fakeClock());

    expect(vi.mocked(core.info).mock.calls[0][0]).toContain('no response: read ECONNRESET)');
  });

  it('gives up after maxRetries and surfaces the last error', async () => {
    const clock = fakeClock();
    const error = httpError(502);
    const perform = vi.fn().mockRejectedValue(error);

    await expect(requestWithTransientRetry(perform, POLICY, clock)).rejects.toBe(error);
    expect(perform).toHaveBeenCalledTimes(POLICY.maxRetries + 1);
    expect(clock.sleeps).toEqual([1_000, 2_000, 4_000]);
  });

  it('rethrows a non-transient error at once', async () => {
    const clock = fakeClock();
    const error = httpError(404);
    const perform = vi.fn().mockRejectedValue(error);

    await expect(requestWithTransientRetry(perform, POLICY, clock)).rejects.toBe(error);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
    expect(core.info).not.toHaveBeenCalled();
  });

  it('waits on real timers when no clock is given', async () => {
    vi.useFakeTimers();
    try {
      const perform = vi.fn().mockRejectedValueOnce(httpError(502)).mockResolvedValueOnce('ok');
      const pending = requestWithTransientRetry(perform, POLICY);

      await vi.advanceTimersByTimeAsync(POLICY.baseDelayMs * 2);

      await expect(pending).resolves.toBe('ok');
      expect(perform).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to Math.random when the clock supplies no jitter source', async () => {
    const sleeps: number[] = [];
    const clock: TransientRetryClock = {
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);

        return Promise.resolve();
      },
    };
    const perform = vi.fn().mockRejectedValueOnce(httpError(504)).mockResolvedValueOnce('ok');

    await expect(requestWithTransientRetry(perform, POLICY, clock)).resolves.toBe('ok');
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(POLICY.baseDelayMs);
    expect(sleeps[0]).toBeLessThanOrEqual(POLICY.baseDelayMs * 2);
  });
});

describe('DEFAULT_TRANSIENT_RETRY_POLICY', () => {
  it('is bounded and short enough not to park a runner on an outage', () => {
    const { baseDelayMs, maxDelayMs, maxRetries } = DEFAULT_TRANSIENT_RETRY_POLICY;
    const worstCaseMs = Array.from({ length: maxRetries }, (_, attempt) =>
      Math.min(baseDelayMs * 2 ** attempt + baseDelayMs, maxDelayMs),
    ).reduce((total, delay) => total + delay, 0);

    expect(maxRetries).toBeGreaterThan(0);
    expect(baseDelayMs).toBeGreaterThan(0);
    expect(maxDelayMs).toBeGreaterThanOrEqual(baseDelayMs);
    expect(worstCaseMs).toBeLessThanOrEqual(15_000);
  });
});
