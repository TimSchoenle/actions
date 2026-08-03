import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_READ_AFTER_WRITE_POLICY, readAfterWrite, type ReadAfterWritePolicy } from './read-after-write.js';

vi.mock('@actions/core');

const POLICY: ReadAfterWritePolicy = { maxRetries: 3, baseDelayMs: 500 };

/** Builds an object shaped like an Octokit `RequestError`. */
function httpError(status: number): unknown {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/** A sleep that records what it was asked to wait for instead of waiting. */
function recordingSleep(): ((milliseconds: number) => Promise<void>) & { waits: number[] } {
  const waits: number[] = [];
  const sleep = (milliseconds: number): Promise<void> => {
    waits.push(milliseconds);

    return Promise.resolve();
  };

  return Object.assign(sleep, { waits });
}

describe('readAfterWrite', () => {
  it('returns the result without waiting when the read succeeds', async () => {
    const sleep = recordingSleep();
    const perform = vi.fn().mockResolvedValue('ok');

    await expect(readAfterWrite(perform, "Branch 'main'", POLICY, sleep)).resolves.toBe('ok');
    expect(perform).toHaveBeenCalledTimes(1);
    expect(sleep.waits).toEqual([]);
  });

  it('retries a 404 until the write has replicated, backing off between attempts', async () => {
    const sleep = recordingSleep();
    const perform = vi
      .fn()
      .mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce('replicated');

    await expect(readAfterWrite(perform, "Branch 'main'", POLICY, sleep)).resolves.toBe('replicated');
    expect(perform).toHaveBeenCalledTimes(3);
    expect(sleep.waits).toEqual([500, 1_000]);
  });

  it('surfaces the 404 once the budget is spent, so a genuinely missing resource still fails', async () => {
    const sleep = recordingSleep();
    const error = httpError(404);
    const perform = vi.fn().mockRejectedValue(error);

    await expect(readAfterWrite(perform, "Branch 'main'", POLICY, sleep)).rejects.toBe(error);
    expect(perform).toHaveBeenCalledTimes(POLICY.maxRetries + 1);
    expect(sleep.waits).toEqual([500, 1_000, 2_000]);
  });

  it.each([401, 403, 422, 500])('does not retry status %i', async (status) => {
    const sleep = recordingSleep();
    const error = httpError(status);
    const perform = vi.fn().mockRejectedValue(error);

    await expect(readAfterWrite(perform, "Branch 'main'", POLICY, sleep)).rejects.toBe(error);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(sleep.waits).toEqual([]);
  });

  it('does not retry an error that carries no HTTP status', async () => {
    const sleep = recordingSleep();
    const error = new Error('socket hang up');
    const perform = vi.fn().mockRejectedValue(error);

    await expect(readAfterWrite(perform, "Branch 'main'", POLICY, sleep)).rejects.toBe(error);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('waits for real when no sleep is injected', async () => {
    vi.useFakeTimers();
    const perform = vi.fn().mockRejectedValueOnce(httpError(404)).mockResolvedValueOnce('replicated');

    const pending = readAfterWrite(perform, "Branch 'main'", POLICY);
    await vi.advanceTimersByTimeAsync(POLICY.baseDelayMs);

    await expect(pending).resolves.toBe('replicated');
    vi.useRealTimers();
  });
});

describe('DEFAULT_READ_AFTER_WRITE_POLICY', () => {
  it('waits long enough to ride out replication without stalling the job', () => {
    const { baseDelayMs, maxRetries } = DEFAULT_READ_AFTER_WRITE_POLICY;

    expect(maxRetries).toBeGreaterThan(0);
    expect(baseDelayMs).toBeGreaterThan(0);

    // Worst case is the sum of the geometric backoff; it must stay well inside a job's patience.
    const worstCaseMs = baseDelayMs * (2 ** maxRetries - 1);
    expect(worstCaseMs).toBeLessThanOrEqual(30_000);
  });
});
