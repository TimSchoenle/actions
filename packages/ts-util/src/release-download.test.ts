import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  apiHeaders,
  assertReleaseAssetRef,
  createHttpTransport,
  InvalidReleaseAssetError,
  isRetryableStatus,
  ReleaseDownloader,
  ReleaseDownloadError,
  releaseDownloadUrl,
  selectAssetId,
} from './release-download.js';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ReleaseAssetRef, ReleaseDownloadPorts } from './release-download.js';

const ASSET: ReleaseAssetRef = { repository: 'jdx/jactionlint', tag: 'v2.5.0', name: 'tool_linux_amd64.tar.gz' };
const DIRECT = 'https://github.com/jdx/jactionlint/releases/download/v2.5.0/tool_linux_amd64.tar.gz';
const RELEASE = 'https://api.github.com/repos/jdx/jactionlint/releases/tags/v2.5.0';
const ASSET_URL = 'https://api.github.com/repos/jdx/jactionlint/releases/assets/42';

const status = (code: number): ReleaseDownloadError =>
  new ReleaseDownloadError(`answered ${code}`, { httpStatusCode: code, retryable: isRetryableStatus(code) });

const RELEASE_JSON = {
  assets: [
    { id: 41, name: 'tool_darwin_arm64.tar.gz', url: 'https://evil.example/41' },
    { id: 42, name: 'tool_linux_amd64.tar.gz', url: 'https://evil.example/42' },
  ],
};

/** Each request is answered by the next queued outcome for its URL, or succeeds when none is left. */
function fakePorts(failures: Record<string, ReleaseDownloadError[]> = {}, release: unknown = RELEASE_JSON) {
  const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];
  const next = (url: string): void => {
    calls.push({ url, headers: {} });
    const error = failures[url]?.shift();

    if (error !== undefined) {
      throw error;
    }
  };
  const ports: ReleaseDownloadPorts = {
    download: vi.fn((url: string, headers: Readonly<Record<string, string>>) => {
      next(url);
      calls.at(-1)!.headers = headers;

      return Promise.resolve();
    }),
    getJson: vi.fn((url: string, headers: Readonly<Record<string, string>>) => {
      next(url);
      calls.at(-1)!.headers = headers;

      return Promise.resolve(release);
    }),
    sleep: vi.fn(() => Promise.resolve()),
    info: vi.fn(),
    warning: vi.fn(),
  };

  return { ports, calls };
}

const ON_GITHUB = { token: 'secret', serverUrl: 'https://github.com' };

describe('ReleaseDownloader', () => {
  it('downloads from the release URL without a token when it answers', async () => {
    const { ports, calls } = fakePorts();

    await new ReleaseDownloader(ports, ON_GITHUB).download(ASSET, '/tmp/out');

    expect(calls).toEqual([{ url: DIRECT, headers: {} }]);
    expect(ports.download).toHaveBeenCalledWith(DIRECT, {}, '/tmp/out');
    expect(ports.warning).not.toHaveBeenCalled();
  });

  it('retries a 5xx, then falls back to the asset endpoint by numeric ID', async () => {
    const { ports, calls } = fakePorts({ [DIRECT]: [status(504), status(504), status(502)] });

    await new ReleaseDownloader(ports, ON_GITHUB).download(ASSET, '/tmp/out');

    expect(calls.map((call) => call.url)).toEqual([DIRECT, DIRECT, DIRECT, RELEASE, ASSET_URL]);
    expect(ports.sleep).toHaveBeenCalledTimes(2);
    expect(ports.warning).toHaveBeenCalledWith(expect.stringContaining('Retrying through the GitHub REST API'));
    expect(calls[3]?.headers).toMatchObject({ Accept: 'application/vnd.github+json', Authorization: 'Bearer secret' });
    expect(calls[4]?.headers).toMatchObject({ Accept: 'application/octet-stream', Authorization: 'Bearer secret' });
    expect(ports.download).toHaveBeenLastCalledWith(ASSET_URL, expect.anything(), '/tmp/out');
  });

  it('succeeds on a retry without falling back', async () => {
    const { ports, calls } = fakePorts({ [DIRECT]: [status(503)] });

    await new ReleaseDownloader(ports, ON_GITHUB).download(ASSET, '/tmp/out');

    expect(calls.map((call) => call.url)).toEqual([DIRECT, DIRECT]);
    expect(ports.warning).not.toHaveBeenCalled();
  });

  it('falls back after connection errors', async () => {
    const cut = (): ReleaseDownloadError => new ReleaseDownloadError('ECONNREFUSED', { retryable: true });
    const { ports, calls } = fakePorts({ [DIRECT]: [cut(), cut(), cut()] });

    await new ReleaseDownloader(ports, ON_GITHUB).download(ASSET, '/tmp/out');

    expect(calls.at(-1)?.url).toBe(ASSET_URL);
  });

  it('withholds the token on GitHub Enterprise Server', async () => {
    const { ports, calls } = fakePorts({ [DIRECT]: [status(500), status(500), status(500)] });

    await new ReleaseDownloader(ports, { token: 'ghes', serverUrl: 'https://ghes.example.com' }).download(
      ASSET,
      '/tmp/out',
    );

    expect(calls.slice(3).map((call) => call.headers.Authorization)).toEqual([undefined, undefined]);
  });

  it('passes a 404 through without asking the API', async () => {
    const { ports, calls } = fakePorts({ [DIRECT]: [status(404)] });

    await expect(new ReleaseDownloader(ports, ON_GITHUB).download(ASSET, '/tmp/out')).rejects.toMatchObject({
      httpStatusCode: 404,
    });
    expect(calls.map((call) => call.url)).toEqual([DIRECT]);
  });

  it.each([
    ['no asset', { assets: [{ id: 41, name: 'tool_darwin_arm64.tar.gz' }] }, /0 assets named/],
    [
      'two assets',
      {
        assets: [
          { id: 42, name: ASSET.name },
          { id: 43, name: ASSET.name },
        ],
      },
      /2 assets named/,
    ],
    ['a non-numeric ID', { assets: [{ id: '42', name: ASSET.name }] }, /not a positive integer/],
    ['no asset list', { message: 'Not Found' }, /lists no assets/],
  ])('refuses a release with %s by that name', async (_label, release, message) => {
    const { ports } = fakePorts({ [DIRECT]: [status(500), status(500), status(500)] }, release);

    await expect(new ReleaseDownloader(ports, ON_GITHUB).download(ASSET, '/tmp/out')).rejects.toThrow(message);
    expect(ports.download).toHaveBeenCalledTimes(3);
  });

  it('looks a release up once for several of its assets', async () => {
    const failing = (url: string) => ({ [url]: [status(500), status(500), status(500)] });
    const other: ReleaseAssetRef = { ...ASSET, name: 'tool_darwin_arm64.tar.gz' };
    const { ports } = fakePorts({ ...failing(DIRECT), ...failing(releaseDownloadUrl(other)) });
    const downloader = new ReleaseDownloader(ports, ON_GITHUB);

    await downloader.download(ASSET, '/tmp/a');
    await downloader.download(other, '/tmp/b');

    expect(ports.getJson).toHaveBeenCalledTimes(1);
    expect(ports.download).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/jdx/jactionlint/releases/assets/41',
      expect.anything(),
      '/tmp/b',
    );
  });

  it('looks a release up again after a failed lookup', async () => {
    const failing = (url: string, code: number) => ({ [url]: [status(code), status(code), status(code)] });
    const other: ReleaseAssetRef = { ...ASSET, name: 'tool_darwin_arm64.tar.gz' };
    const { ports } = fakePorts({
      ...failing(DIRECT, 500),
      ...failing(releaseDownloadUrl(other), 500),
      [RELEASE]: [status(403)],
    });
    const downloader = new ReleaseDownloader(ports, ON_GITHUB);

    await expect(downloader.download(ASSET, '/tmp/a')).rejects.toMatchObject({ httpStatusCode: 403 });
    await downloader.download(other, '/tmp/b');

    expect(ports.getJson).toHaveBeenCalledTimes(2);
  });

  it('refuses a ref that would change the URL path before any request', async () => {
    const { ports } = fakePorts();

    await expect(
      new ReleaseDownloader(ports, ON_GITHUB).download({ ...ASSET, tag: '../../../../evil' }, '/tmp/out'),
    ).rejects.toThrow(InvalidReleaseAssetError);
    expect(ports.download).not.toHaveBeenCalled();
  });
});

describe('assertReleaseAssetRef', () => {
  it.each<[keyof ReleaseAssetRef, string]>([
    ['repository', 'jdx'],
    ['repository', 'jdx/..'],
    ['repository', 'jdx/a/b'],
    ['repository', '-x/repo'],
    ['tag', ''],
    ['tag', 'v1 0'],
    ['tag', 'a/../b'],
    ['name', ''],
    ['name', '..'],
    ['name', 'dir/file'],
    ['name', String.raw`dir\file`],
    ['name', 'line\nbreak'],
    ['name', 'tool:stream'],
    ['name', 'what?.tar.gz'],
  ])('refuses %s %j', (field, value) => {
    expect(() => assertReleaseAssetRef({ ...ASSET, [field]: value })).toThrow(
      expect.objectContaining({ field }) as Error,
    );
  });

  it('accepts a tag with a slash, and encodes each segment', () => {
    const asset = { ...ASSET, tag: 'tools/v1+build', name: 'a b.tar.gz'.replace(' ', '_') };

    expect(() => assertReleaseAssetRef(asset)).not.toThrow();
    expect(releaseDownloadUrl(asset)).toBe(
      'https://github.com/jdx/jactionlint/releases/download/tools/v1%2Bbuild/a_b.tar.gz',
    );
  });
});

describe('apiHeaders', () => {
  it('sends the token only to a github.com job', () => {
    expect(apiHeaders(ON_GITHUB, 'x').Authorization).toBe('Bearer secret');
    expect(apiHeaders({ token: 'secret', serverUrl: '' }, 'x').Authorization).toBeUndefined();
    expect(apiHeaders({ token: 'secret', serverUrl: 'https://github.com.evil' }, 'x').Authorization).toBeUndefined();
    expect(apiHeaders({ token: '', serverUrl: 'https://github.com' }, 'x').Authorization).toBeUndefined();
  });
});

describe('selectAssetId', () => {
  it('returns the ID and ignores the url field', () => {
    expect(selectAssetId(RELEASE_JSON, ASSET)).toBe(42);
  });
});

describe('createHttpTransport', () => {
  let server: Server | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    // A stalled response holds its connection open, and close() would wait for it.
    server?.closeAllConnections();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;

    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  /** A local server answering every request with `handler`, and its base URL. */
  async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
    server = createServer(handler);
    // Every interface, so a redirect to localhost reaches it whether that resolves to IPv4 or IPv6.
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function target(): Promise<string> {
    directory = await mkdtemp(path.join(tmpdir(), 'release-download-'));

    return path.join(directory, 'file');
  }

  const transport = createHttpTransport('test', { idleMs: 2000 });

  it('writes a 200 body to the destination, following a redirect', async () => {
    const base = await serve((request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { Location: `http://${request.headers.host ?? ''}/file` }).end();
      } else {
        response.end('payload');
      }
    });
    const file = await target();

    await transport.download(`${base}/start`, {}, file);

    expect(await readFile(file, 'utf8')).toBe('payload');
  });

  it('reports a 5xx as retryable and a 404 as not', async () => {
    const base = await serve((request, response) => {
      response.statusCode = request.url === '/missing' ? 404 : 504;
      response.end('error page');
    });
    const file = await target();

    await expect(transport.download(`${base}/down`, {}, file)).rejects.toMatchObject({
      httpStatusCode: 504,
      retryable: true,
    });
    await expect(transport.download(`${base}/missing`, {}, file)).rejects.toMatchObject({
      httpStatusCode: 404,
      retryable: false,
    });
  });

  it('reports a body cut short as retryable', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Length': '100' });
      // Cut only once the client has had time to read the partial body, so the failure comes from the
      // truncated body and not from a connection lost before the response arrived.
      response.write('short', () => setTimeout(() => response.socket?.destroy(), 100));
    });
    const file = await target();

    await expect(transport.download(`${base}/cut`, {}, file)).rejects.toMatchObject({ retryable: true });
    expect(await readFile(file, 'utf8')).toBe('short');
  });

  it('reports a refused connection as retryable', async () => {
    const base = await serve((_request, response) => response.end());
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;

    await expect(transport.download(`${base}/gone`, {}, await target())).rejects.toMatchObject({ retryable: true });
  });

  it('parses a JSON body and refuses one that is not JSON', async () => {
    const base = await serve((request, response) => response.end(request.url === '/json' ? '{"a":1}' : 'nope'));

    expect(await transport.getJson(`${base}/json`, {})).toEqual({ a: 1 });
    await expect(transport.getJson(`${base}/text`, {})).rejects.toMatchObject({ retryable: false });
  });

  it('reports a JSON request answered with a 5xx as retryable and a 404 as not', async () => {
    const base = await serve((request, response) => {
      response.statusCode = request.url === '/missing' ? 404 : 503;
      response.end('{"message":"error"}');
    });

    await expect(transport.getJson(`${base}/busy`, {})).rejects.toMatchObject({
      httpStatusCode: 503,
      retryable: true,
    });
    await expect(transport.getJson(`${base}/missing`, {})).rejects.toMatchObject({
      httpStatusCode: 404,
      retryable: false,
    });
  });

  it('drops the Authorization header when a redirect leaves the host', async () => {
    const seen: (string | undefined)[] = [];
    const base = await serve((request, response) => {
      seen.push(request.headers.authorization);

      if (request.url === '/asset') {
        const port = (server!.address() as AddressInfo).port;

        response.writeHead(302, { Location: `http://localhost:${port}/storage` }).end();
      } else {
        response.end('payload');
      }
    });

    await transport.download(`${base}/asset`, { Authorization: 'Bearer secret' }, await target());

    expect(seen).toEqual(['Bearer secret', undefined]);
  });

  it('reports a body that stops arriving as retryable, within the idle timeout', async () => {
    const quick = createHttpTransport('test', { idleMs: 300 });
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Length': '100' });
      response.write('{"partial":');
    });

    const stalled = { retryable: true, message: expect.stringContaining('no data arrived for 0.3s') as string };

    await expect(quick.download(`${base}/stall`, {}, await target())).rejects.toMatchObject(stalled);
    await expect(quick.getJson(`${base}/stall`, {})).rejects.toMatchObject(stalled);
  });

  it('reports a destination it cannot write as not retryable', async () => {
    const base = await serve((_request, response) => response.end('payload'));
    const missing = path.join(path.dirname(await target()), 'no-such-directory', 'file');

    const quick = createHttpTransport('test', { idleMs: 50 });

    await expect(quick.download(`${base}/file`, {}, missing)).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('Cannot write') as string,
    });
    // Past the idle limit: an idle guard left behind by the failed open would now throw uncaught,
    // which vitest reports as a failure.
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  /**
   * A server answering every request with `statusCode` and a body that never ends, and whether the
   * connection of the last request has closed.
   */
  async function serveEndless(statusCode: number): Promise<{ base: string; closed: () => boolean }> {
    let closed = false;
    const base = await serve((_request, response) => {
      response.socket?.once('close', () => {
        closed = true;
      });
      response.writeHead(statusCode);
      const stream = setInterval(() => response.write('x'.repeat(1024)), 5);
      response.once('close', () => clearInterval(stream));
    });

    return { base, closed: () => closed };
  }

  it('closes a response that never finishes when the destination cannot open', async () => {
    const { base, closed } = await serveEndless(200);
    const missing = path.join(path.dirname(await target()), 'no-such-directory', 'file');

    await expect(transport.download(`${base}/file`, {}, missing)).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('Cannot write') as string,
    });
    await expect.poll(closed).toBe(true);
  });

  it('closes a failed response without reading its body', async () => {
    const { base, closed } = await serveEndless(503);

    await expect(transport.download(`${base}/file`, {}, await target())).rejects.toMatchObject({
      httpStatusCode: 503,
      retryable: true,
    });
    await expect.poll(closed).toBe(true);
  });
});
