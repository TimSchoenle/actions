import path from 'node:path';

import * as core from 'actions-util/core';
import { ReleaseDownloadError } from 'actions-util/release-download';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvalidInputError, run, verificationFrom } from './action.js';

import type { ActionDependencies } from './action.js';

/**
 * Only the reporting side of `actions-util/core` is mocked; inputs are published as `INPUT_*`
 * environment variables, the way the runner does.
 */
vi.mock('actions-util/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

const DIRECTORY = path.resolve('/runner/temp/download-release-asset-x');
const LIST_DIRECTORY = path.resolve('/runner/temp/download-release-asset-y');
const ASSET = 'tool_linux_amd64.tar.gz';
const SUMS = 'tool_checksums.txt';
const A = 'a'.repeat(64);
const S = 'c'.repeat(64);

function setInputs(inputs: Record<string, string>): void {
  const all = { repository: 'jdx/jactionlint', tag: 'v2.5.0', asset: ASSET, token: 'token', sha256: '', ...inputs };

  for (const [name, value] of Object.entries(all)) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

/** Every file hashes to `digests[name]`, and the checksums file lists the asset with {@link A}. */
function dependencies(digests: Record<string, string> = { [ASSET]: A, [SUMS]: S }): ActionDependencies {
  return {
    download: vi.fn(() => Promise.resolve()),
    files: {
      readText: vi.fn(() => Promise.resolve(`${A}  ${ASSET}\n`)),
      sha256: vi.fn((file: string) => Promise.resolve(digests[path.basename(file)] ?? '')),
    },
    makeDirectory: vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(DIRECTORY)
      .mockResolvedValueOnce(LIST_DIRECTORY),
    removeDirectory: vi.fn(() => Promise.resolve()),
    serverUrl: 'https://github.com',
  };
}

function failure(): string | undefined {
  return vi.mocked(core.setFailed).mock.calls[0]?.[0] as string | undefined;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('download-release-asset action', () => {
  it('downloads the asset, verifies its pinned SHA-256 and outputs its path', async () => {
    setInputs({ sha256: A.toUpperCase() });
    const deps = dependencies();

    await run(deps);

    expect(failure()).toBeUndefined();
    expect(deps.download).toHaveBeenCalledWith(
      { token: 'token', serverUrl: 'https://github.com' },
      { repository: 'jdx/jactionlint', tag: 'v2.5.0', name: ASSET },
      path.join(DIRECTORY, ASSET),
    );
    expect(core.setOutput).toHaveBeenCalledWith('path', path.join(DIRECTORY, ASSET));
  });

  it('verifies the checksums file before downloading the asset, then the asset against it', async () => {
    setInputs({ 'checksums-asset': SUMS, 'checksums-sha256': S });
    const deps = dependencies();

    await run(deps);

    expect(failure()).toBeUndefined();
    expect(vi.mocked(deps.download).mock.calls.map((call) => call[2])).toEqual([
      path.join(LIST_DIRECTORY, SUMS),
      path.join(DIRECTORY, ASSET),
    ]);
    expect(deps.removeDirectory).toHaveBeenCalledTimes(1);
    expect(deps.removeDirectory).toHaveBeenCalledWith(LIST_DIRECTORY);
    expect(core.setOutput).toHaveBeenCalledWith('path', path.join(DIRECTORY, ASSET));
  });

  it('stops before the asset download when the checksums file does not match its pin', async () => {
    setInputs({ 'checksums-asset': SUMS, 'checksums-sha256': 'd'.repeat(64) });
    const deps = dependencies();

    await run(deps);

    expect(failure()).toMatch(/tool_checksums\.txt: SHA-256 is c+, but d+ was pinned/);
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.removeDirectory).mock.calls).toEqual([[LIST_DIRECTORY], [DIRECTORY]]);
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails, removes the download and sets no output on a checksum mismatch', async () => {
    setInputs({ sha256: 'b'.repeat(64) });
    const deps = dependencies();

    await run(deps);

    expect(failure()).toMatch(/was pinned/);
    expect(deps.removeDirectory).toHaveBeenCalledWith(DIRECTORY);
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('refuses an asset the checksums file does not match', async () => {
    setInputs({ 'checksums-asset': SUMS, 'checksums-sha256': S });
    const deps = dependencies({ [ASSET]: 'b'.repeat(64), [SUMS]: S });

    await run(deps);

    expect(failure()).toMatch(/tool_checksums\.txt records a+/);
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('passes a download failure through and leaves nothing behind', async () => {
    setInputs({ sha256: A });
    const deps = dependencies();

    vi.mocked(deps.download).mockRejectedValue(
      new ReleaseDownloadError('GET … answered 404.', { httpStatusCode: 404, retryable: false }),
    );

    await run(deps);

    expect(failure()).toMatch(/answered 404/);
    expect(deps.removeDirectory).toHaveBeenCalledWith(DIRECTORY);
  });

  it('reports the download failure, not a failed cleanup', async () => {
    setInputs({ sha256: 'b'.repeat(64) });
    const deps = dependencies();

    vi.mocked(deps.removeDirectory).mockRejectedValue(new Error('EBUSY'));

    await run(deps);

    expect(failure()).toMatch(/was pinned/);
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('EBUSY'));
  });

  it.each([
    [{ 'checksums-asset': ASSET.toUpperCase(), 'checksums-sha256': S }, /checksums-asset: must name a different file/],
    [{ repository: 'jdx', sha256: A }, /^repository: must be owner\/repo/],
    [{ tag: 'a/../b', sha256: A }, /^tag: must be/],
    [{ asset: '../escape', sha256: A }, /^asset: must be/],
    [{ 'checksums-asset': 'dir/sums', 'checksums-sha256': S }, /^checksums-asset: must be/],
    [{ 'checksums-asset': ASSET, 'checksums-sha256': S }, /checksums-asset: must name a different file/],
  ])('refuses %j before downloading anything', async (inputs, message) => {
    setInputs(inputs);
    const deps = dependencies();

    await run(deps);

    expect(failure()).toMatch(message);
    expect(deps.makeDirectory).not.toHaveBeenCalled();
  });
});

describe('verificationFrom', () => {
  it('takes sha256 alone', () => {
    expect(verificationFrom(A, '', '')).toEqual({ kind: 'sha256', sha256: A });
  });

  it('takes the checksums pair', () => {
    expect(verificationFrom('', SUMS, S)).toEqual({ kind: 'checksums', name: SUMS, sha256: S });
  });

  it.each([
    [A, SUMS, S, 'sha256'],
    ['', '', '', 'sha256'],
    ['', SUMS, '', 'checksums-sha256'],
    ['', '', S, 'checksums-asset'],
  ])('refuses sha256=%j checksums-asset=%j checksums-sha256=%j', (sha256, asset, sums, input) => {
    expect(() => verificationFrom(sha256, asset, sums)).toThrow(
      expect.objectContaining({ input }) as InvalidInputError,
    );
  });

  it.each([
    ['xyz', '', '', 'sha256'],
    ['', SUMS, `${S}0`, 'checksums-sha256'],
  ])('refuses a pin that is not 64 hex digits: %j %j %j', (sha256, asset, sums, input) => {
    expect(() => verificationFrom(sha256, asset, sums)).toThrow(
      expect.objectContaining({ input }) as InvalidInputError,
    );
  });
});
