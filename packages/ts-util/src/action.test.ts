import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runAction } from './action.js';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  setFailed: vi.fn(),
}));

describe('runAction', () => {
  beforeEach(() => {
    vi.mocked(core.setFailed).mockClear();
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

  it('fails the step with a generic message when a non-Error is thrown', async () => {
    await runAction(async () => {
      throw 'string error';
    });

    expect(core.setFailed).toHaveBeenCalledWith('Unknown error occurred');
  });

  it('resolves rather than rejecting, so a failure never escapes as an unhandled rejection', async () => {
    await expect(
      runAction(async () => {
        throw new Error('boom');
      }),
    ).resolves.toBeUndefined();
  });
});
