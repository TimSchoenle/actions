import { HttpClient } from '@actions/http-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReleaseNotFoundError } from './errors.js';
import { fetchJson, listReleases } from './releases.js';

import type { HttpClientResponse } from '@actions/http-client';

vi.mock('@actions/http-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@actions/http-client')>();

  actual.HttpClient.prototype.get = vi.fn();

  return actual;
});

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
    vi.mocked(HttpClient.prototype.get).mockResolvedValue({
      message: { statusCode: status, statusMessage },
      readBody: () => Promise.resolve(body),
    } as unknown as HttpClientResponse);
  }

  afterEach(() => {
    vi.mocked(HttpClient.prototype.get).mockReset();
  });

  it('sends the token as a bearer credential and parses the body', async () => {
    answer(200, '[]');

    expect(await fetchJson('https://api.github.com/x', 'secret')).toEqual([]);
    expect(vi.mocked(HttpClient.prototype.get).mock.calls[0]?.[1]).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('sends no credential without a token', async () => {
    answer(200, '[]');

    await fetchJson('https://api.github.com/x', '');
    expect(vi.mocked(HttpClient.prototype.get).mock.calls[0]?.[1]).not.toHaveProperty('Authorization');
  });

  it('reports an HTTP failure', async () => {
    answer(403, '{}', 'Forbidden');

    await expect(fetchJson('https://api.github.com/x', '')).rejects.toThrow(/403 Forbidden/);
  });
});
