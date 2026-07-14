import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runAction } from './action.js';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  debug: vi.fn(),
  setFailed: vi.fn(),
}));

describe('runAction', () => {
  beforeEach(() => {
    vi.mocked(core.setFailed).mockClear();
    vi.mocked(core.debug).mockClear();
  });

  it('runs a synchronous body without failing the step', () => {
    const body = vi.fn();

    runAction(body);

    expect(body).toHaveBeenCalledOnce();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('runs an asynchronous body without failing the step', async () => {
    await runAction(async () => {
      await Promise.resolve();
    });

    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails the step with the message of an error thrown synchronously', () => {
    runAction(() => {
      throw new Error('sync boom');
    });

    expect(core.setFailed).toHaveBeenCalledWith('sync boom');
  });

  it('fails the step with the message of a rejected body', async () => {
    await runAction(async () => {
      await Promise.reject(new Error('async boom'));
    });

    expect(core.setFailed).toHaveBeenCalledWith('async boom');
  });

  it('keeps the message of a thrown non-Error rather than discarding it', async () => {
    await runAction(async () => {
      throw 'string error';
    });

    expect(core.setFailed).toHaveBeenCalledWith('string error');
  });

  it.each([null, undefined, ''])('falls back to a generic message for the empty failure %o', async (thrown) => {
    await runAction(async () => {
      throw thrown;
    });

    expect(core.setFailed).toHaveBeenCalledWith('Unknown error occurred');
  });

  it('reports the cause chain on the debug channel, without the object graph around it', async () => {
    const cause = new Error('permission denied');

    await runAction(async () => {
      throw new Error('failed to close PR #1', { cause });
    });

    const debugged = vi.mocked(core.debug).mock.calls[0][0];

    expect(debugged).toContain('failed to close PR #1');
    expect(debugged).toContain('Caused by:');
    expect(debugged).toContain('permission denied');
  });

  it('resolves rather than rejecting, so a failure never escapes as an unhandled rejection', async () => {
    await expect(
      runAction(async () => {
        throw new Error('boom');
      }),
    ).resolves.toBeUndefined();
  });
});
