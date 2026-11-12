import { Readable } from 'node:stream';

import { httpRequest } from 'actions-util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReleaseNotFoundError } from './errors.js';
import { fetchJson, latestRelease, MAX_PAGE_BYTES } from './releases.js';

import type { HttpResponse } from 'actions-util';

vi.mock('actions-util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('actions-util')>()),
  httpRequest: vi.fn(),
}));

describe('latestRelease', () => {
  const ref = (tag: string) => ({ ref: `refs/tags/${tag}`, object: { type: 'commit', sha: 'a'.repeat(40) } });

  /** A fake API: the tags `matching-refs` lists, and the release each tag has (`undefined`: none). */
  function api(tags: readonly string[], releases: Record<string, object | undefined>) {
    return vi.fn((url: string) => {
      const parsed = new URL(url);
      const refs = /\/git\/matching-refs\/tags\/(.+)$/.exec(parsed.pathname);
      if (refs !== null) {
        const prefix = decodeURIComponent(refs[1] ?? '');
        return Promise.resolve(tags.filter((tag) => tag.startsWith(prefix)).map(ref));
      }
      const release = /\/releases\/tags\/(.+)$/.exec(parsed.pathname);
      if (release !== null) {
        return Promise.resolve(releases[decodeURIComponent(release[1] ?? '')]);
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
  }

  // P14e: a MAJOR.MINOR request paged the whole release list, notes included, on every job.
  it('lists only the tags of the line and confirms the newest patch, without listing releases', async () => {
    const fetch = api(
      ['terrace-contract-v0.8.0', 'terrace-contract-v0.8.2', 'terrace-contract-v0.80.1', 'terrace-contract-v0.9.0'],
      { 'terrace-contract-v0.8.2': { tag_name: 'terrace-contract-v0.8.2', prerelease: false } },
    );

    expect(await latestRelease(fetch, 'token', 0, 8)).toEqual({ major: 0, minor: 8, patch: 2 });
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/repos/TimSchoenle/terrace-config/git/matching-refs/tags/terrace-contract-v0.8.',
      '/repos/TimSchoenle/terrace-config/releases/tags/terrace-contract-v0.8.2',
    ]);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), 'token');
  });

  it('skips a tag without a published release and a pre-release, and ignores pre-release tags', async () => {
    const fetch = api(
      ['terrace-contract-v0.8.0', 'terrace-contract-v0.8.1', 'terrace-contract-v0.8.2', 'terrace-contract-v0.8.3-rc.1'],
      {
        'terrace-contract-v0.8.0': { tag_name: 'terrace-contract-v0.8.0' },
        'terrace-contract-v0.8.1': { tag_name: 'terrace-contract-v0.8.1', prerelease: true },
      },
    );

    expect(await latestRelease(fetch, '', 0, 8)).toEqual({ major: 0, minor: 8, patch: 0 });
  });

  it('finds nothing for a line without a published release', async () => {
    expect(await latestRelease(api(['terrace-contract-v0.9.0'], {}), '', 0, 8)).toBeUndefined();
  });

  it('reads further pages of tags while they are full, and no more than ten', async () => {
    const full = Array.from({ length: 100 }, () => ref('terrace-contract-v0.8.0-rc.1'));
    const fetch = vi.fn().mockResolvedValue(full);

    expect(await latestRelease(fetch, '', 0, 8)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('refuses a tag listing that is not a list', async () => {
    await expect(latestRelease(vi.fn().mockResolvedValue({ message: 'Not Found' }), '', 0, 8)).rejects.toThrow(
      ReleaseNotFoundError,
    );
    await expect(latestRelease(vi.fn().mockResolvedValue(undefined), '', 0, 8)).rejects.toThrow(ReleaseNotFoundError);
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

  it('answers a 404 with nothing, closing the response unread', async () => {
    answer(404, '{"message":"Not Found"}', 'Not Found');

    expect(await fetchJson('https://api.github.com/x', '')).toBeUndefined();
    const { message } = await vi.mocked(httpRequest).mock.results[0]!.value;
    expect(message.destroyed).toBe(true);
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
