import { Readable } from 'node:stream';

import { httpRequest } from 'actions-util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReleaseNotFoundError } from './errors.js';
import { fetchJson, listReleases, MAX_PAGE_BYTES } from './releases.js';

import type { HttpResponse } from 'actions-util';

vi.mock('actions-util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('actions-util')>()),
  httpRequest: vi.fn(),
}));

describe('listReleases', () => {
  it('keeps only published terrace-contract releases', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce([
        { tag_name: 'terrace-contract-v0.8.0' },
        { tag_name: 'terrace-contract-v0.9.0', draft: true },
        { tag_name: 'terrace-contract-v0.9.0-rc.1', prerelease: true },
        { tag_name: 'terrace-config-java-v0.6.2' },
        { tag_name: 'terrace-contract-v0.7.3' },
        { name: 'no tag' },
      ]);

    expect(await listReleases(fetch, 'token')).toEqual([
      { major: 0, minor: 8, patch: 0 },
      { major: 0, minor: 7, patch: 3 },
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('per_page=100&page=1'), 'token');
  });

  it('reads further pages while they are full, and no more than ten', async () => {
    const full = Array.from({ length: 100 }, () => ({ tag_name: 'v0.15.2' }));
    const fetch = vi.fn().mockResolvedValue(full);

    expect(await listReleases(fetch, '')).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('refuses an answer that is not a list', async () => {
    await expect(listReleases(vi.fn().mockResolvedValue({ message: 'Not Found' }), '')).rejects.toThrow(
      ReleaseNotFoundError,
    );
  });
});

describe('fetchJson', () => {
  function answer(status: number, body: string, statusMessage = ''): void {
    vi.mocked(httpRequest).mockImplementation((url) =>
      Promise.resolve({
        url,
        message: Object.assign(Readable.from([Buffer.from(body)]), { statusCode: status, statusMessage }),
      } as unknown as HttpResponse),
    );
  }

  /** The headers of the first request sent. */
  function sentHeaders(): Readonly<Record<string, string>> | undefined {
    return vi.mocked(httpRequest).mock.calls[0]?.[1]?.headers;
  }

  afterEach(() => {
    vi.mocked(httpRequest).mockReset();
  });

  it('sends the token as a bearer credential and parses the body', async () => {
    answer(200, '[]');

    expect(await fetchJson('https://api.github.com/x', 'secret')).toEqual([]);
    expect(sentHeaders()).toMatchObject({ Authorization: 'Bearer secret', 'User-Agent': 'terrace-setup' });
  });

  it('sends no credential without a token', async () => {
    answer(200, '[]');

    await fetchJson('https://api.github.com/x', '');
    expect(sentHeaders()).not.toHaveProperty('Authorization');
  });

  it('reports an HTTP failure, closing the response unread', async () => {
    answer(403, '{}', 'Forbidden');

    await expect(fetchJson('https://api.github.com/x', '')).rejects.toThrow(/403 Forbidden/);
    const { message } = await vi.mocked(httpRequest).mock.results[0]!.value;
    expect(message.destroyed).toBe(true);
  });

  it('stops reading a page past the size limit', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    const endless = Readable.from(
      (function* () {
        for (;;) {
          yield chunk;
        }
      })(),
    );
    vi.mocked(httpRequest).mockResolvedValue({
      url: 'https://api.github.com/x',
      message: Object.assign(endless, { statusCode: 200, statusMessage: 'OK' }),
    } as unknown as HttpResponse);

    await expect(fetchJson('https://api.github.com/x', '')).rejects.toThrow(
      `The response body is larger than the limit of ${MAX_PAGE_BYTES} bytes.`,
    );
    expect(endless.destroyed).toBe(true);
  });
});
