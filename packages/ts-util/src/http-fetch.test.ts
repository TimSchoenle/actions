import http from 'node:http';
import net from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProxyAwareFetch } from './http-fetch.js';

import type { AddressInfo } from 'node:net';

const servers: net.Server[] = [];
const sockets: net.Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }

  for (const server of servers.splice(0)) {
    (server as http.Server).closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function listen(server: net.Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return (server.address() as AddressInfo).port;
}

/** An origin behind a `CONNECT` proxy, returning the proxy's URL and the requests the origin saw. */
async function proxiedOrigin(handler: http.RequestListener): Promise<{
  proxyUrl: string;
  seen: { method?: string; url?: string; body: string; headers: http.IncomingHttpHeaders }[];
}> {
  const seen: { method?: string; url?: string; body: string; headers: http.IncomingHttpHeaders }[] = [];
  const target = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      });
      handler(request, response);
    });
  });
  const targetPort = await listen(target);
  const proxy = http.createServer();
  proxy.on('connect', (_request, socket: net.Socket, head: Buffer) => {
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    sockets.push(socket, upstream);
  });

  return { proxyUrl: `http://127.0.0.1:${await listen(proxy)}`, seen };
}

describe('createProxyAwareFetch', () => {
  it('hands a request that goes direct to the native fetch unchanged', async () => {
    const response = new Response('native');
    const nativeFetch = vi.fn().mockResolvedValue(response);
    const init = { method: 'POST', body: 'x' };

    const result = await createProxyAwareFetch({}, nativeFetch)('https://api.github.com/x', init);

    expect(result).toBe(response);
    expect(nativeFetch).toHaveBeenCalledWith('https://api.github.com/x', init);
  });

  it('uses the native fetch for a host NO_PROXY lists', async () => {
    const nativeFetch = vi.fn().mockResolvedValue(new Response());

    await createProxyAwareFetch(
      { HTTPS_PROXY: 'http://proxy', NO_PROXY: 'github.com' },
      nativeFetch,
    )(new URL('https://api.github.com/'));

    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it('carries a proxied request and answers as fetch does', async () => {
    const { proxyUrl, seen } = await proxiedOrigin((_request, response) => {
      response.setHeader('Set-Cookie', ['a=1', 'b=2']);
      response.writeHead(201, 'Created', { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '42' });
      response.end('{"ok":true}');
    });
    const nativeFetch = vi.fn();

    const response = await createProxyAwareFetch({ HTTP_PROXY: proxyUrl }, nativeFetch)('http://api.test/repos', {
      method: 'POST',
      body: '{"title":"x"}',
      headers: { 'Content-Type': 'application/json', authorization: 'token t' },
    });

    expect(nativeFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(response.url).toBe('http://api.test/repos');
    expect(response.redirected).toBe(false);
    expect(response.headers.get('x-ratelimit-remaining')).toBe('42');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await response.json()).toEqual({ ok: true });
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/repos', body: '{"title":"x"}' });
    expect(seen[0]?.headers).toMatchObject({ 'content-type': 'application/json', authorization: 'token t' });
  });

  it('decodes a gzip body', async () => {
    const { proxyUrl } = await proxiedOrigin((_request, response) => {
      response.writeHead(200, { 'Content-Encoding': 'gzip' });
      response.end(gzipSync('compressed text'));
    });

    const response = await createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://api.test/');

    expect(await response.text()).toBe('compressed text');
  });

  it('follows redirects and reports the final URL', async () => {
    const { proxyUrl } = await proxiedOrigin((request, response) => {
      if (request.url === '/old') {
        response.writeHead(301, { Location: '/new' }).end();
      } else {
        response.end('moved');
      }
    });

    const response = await createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://api.test/old');

    expect(response.url).toBe('http://api.test/new');
    expect(response.redirected).toBe(true);
    expect(await response.text()).toBe('moved');
  });

  it('returns a redirect as it is under redirect: manual, and refuses it under redirect: error', async () => {
    const { proxyUrl } = await proxiedOrigin((_request, response) => response.writeHead(302, { Location: '/x' }).end());
    const proxiedFetch = createProxyAwareFetch({ HTTP_PROXY: proxyUrl });

    const manual = await proxiedFetch('http://api.test/', { redirect: 'manual' });

    expect(manual.status).toBe(302);
    expect(manual.headers.get('location')).toBe('/x');
    await expect(proxiedFetch('http://api.test/', { redirect: 'error' })).rejects.toThrow(TypeError);
  });

  it('answers a bodiless status and a HEAD request with a null body', async () => {
    const { proxyUrl } = await proxiedOrigin((request, response) => {
      response.writeHead(request.url === '/none' ? 204 : 200).end();
    });
    const proxiedFetch = createProxyAwareFetch({ HTTP_PROXY: proxyUrl });

    expect((await proxiedFetch('http://api.test/none')).body).toBeNull();
    expect((await proxiedFetch('http://api.test/head', { method: 'HEAD' })).body).toBeNull();
  });

  it('rejects, rather than throwing, on a proxy variable that is no proxy URL', async () => {
    const proxiedFetch = createProxyAwareFetch({ HTTPS_PROXY: 'socks5://proxy' });

    await expect(proxiedFetch('https://api.github.com/')).rejects.toThrow(/not a valid http/);
  });

  it('refuses a body it cannot send', async () => {
    const { proxyUrl } = await proxiedOrigin((_request, response) => response.end());

    await expect(
      createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://api.test/', { method: 'POST', body: new FormData() }),
    ).rejects.toThrow('The proxied fetch only sends string and byte bodies.');
  });
});
