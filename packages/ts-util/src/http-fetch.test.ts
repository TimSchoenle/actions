import http from 'node:http';
import net from 'node:net';
import { pipeline } from 'node:stream';
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from 'node:zlib';

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

  return { proxyUrl: await connectProxy(await listen(target)), seen };
}

/** A `CONNECT` proxy that sends every tunnel to `targetPort` on 127.0.0.1, returning its URL. */
async function connectProxy(targetPort: number): Promise<string> {
  const proxy = http.createServer();
  proxy.on('connect', (_request, socket: net.Socket, head: Buffer) => {
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      // `pipeline`, not `.pipe()`: a relayed write that lands after the client hung up raises EPIPE,
      // and without the error listener `pipeline` attaches, Vitest fails the run on an unhandled error.
      pipeline(upstream, socket, () => {});
      pipeline(socket, upstream, () => {});
    });
    sockets.push(socket, upstream);
  });

  return `http://127.0.0.1:${await listen(proxy)}`;
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

  it.each([
    { name: 'gzip', encoding: 'gzip', compress: gzipSync },
    { name: 'zlib deflate', encoding: 'deflate', compress: deflateSync },
    { name: 'raw deflate', encoding: 'deflate', compress: deflateRawSync },
    { name: 'brotli', encoding: 'br', compress: brotliCompressSync },
  ])('decodes a $name body', async ({ encoding, compress }) => {
    const text = 'compressed text '.repeat(1000);
    const { proxyUrl } = await proxiedOrigin((_request, response) => {
      response.writeHead(200, { 'Content-Encoding': encoding });
      response.end(compress(text));
    });

    const response = await createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://api.test/');

    expect(await response.text()).toBe(text);
  });

  it('decodes an empty deflate body', async () => {
    const { proxyUrl } = await proxiedOrigin((_request, response) => {
      response.writeHead(200, { 'Content-Encoding': 'deflate' }).end();
    });

    expect(await (await createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://api.test/')).text()).toBe('');
  });

  it('asks for every encoding it decodes, unless the caller chose', async () => {
    const { proxyUrl, seen } = await proxiedOrigin((_request, response) => response.end());
    const proxiedFetch = createProxyAwareFetch({ HTTP_PROXY: proxyUrl });

    await (await proxiedFetch('http://api.test/default')).text();
    await (await proxiedFetch('http://api.test/chosen', { headers: { 'Accept-Encoding': 'identity' } })).text();

    expect(seen.map((entry) => entry.headers['accept-encoding'])).toEqual(['gzip, deflate, br', 'identity']);
  });

  it('fails the body when the connection is cut mid-way through a gzip stream', async () => {
    const compressed = gzipSync('x'.repeat(100_000));
    const origin = net.createServer((socket) => {
      sockets.push(socket);
      socket.once('data', () => {
        socket.write(`HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${compressed.length}\r\n\r\n`);
        socket.end(compressed.subarray(0, compressed.length / 2), () => socket.destroy());
      });
    });
    const proxyUrl = await connectProxy(await listen(origin));

    const response = await createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://api.test/');

    await expect(response.text()).rejects.toThrow();
  });

  it('closes the connection when the body is cancelled', async () => {
    let closed = false;
    const origin = net.createServer((socket) => {
      sockets.push(socket);
      // The interval below can write after the proxy closes this socket; that EPIPE is expected.
      socket.on('error', () => {});
      socket.once('data', () => {
        // A gzip body that never ends.
        socket.write('HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nTransfer-Encoding: chunked\r\n\r\n');
        const header = gzipSync('').subarray(0, 10);
        socket.write(`${header.length.toString(16)}\r\n`);
        socket.write(header);
        socket.write('\r\n');
        const stream = setInterval(() => socket.write('1\r\n\u0000\r\n'), 5);
        socket.once('close', () => {
          clearInterval(stream);
          closed = true;
        });
      });
    });
    const proxyUrl = await connectProxy(await listen(origin));

    const response = await createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://api.test/');
    await response.body?.cancel();

    await expect.poll(() => closed).toBe(true);
  });

  it('refuses a URL that includes credentials, as fetch does', async () => {
    const { proxyUrl, seen } = await proxiedOrigin((_request, response) => response.end());

    const failure = createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://user:secret@api.test/');

    await expect(failure).rejects.toThrow(TypeError);
    await expect(failure).rejects.not.toThrow(/secret/);
    expect(seen).toEqual([]);
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

  it('fails as fetch does when the redirects run out under redirect: follow', async () => {
    const { proxyUrl, seen } = await proxiedOrigin((_request, response) => {
      response.writeHead(302, { Location: '/again' }).end('redirect body');
    });

    const failure = createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://api.test/');

    await expect(failure).rejects.toThrow(new TypeError('fetch failed'));
    await expect(failure).rejects.toHaveProperty('cause.message', 'redirect count exceeded');
    // The first request and the 20 redirects fetch follows.
    expect(seen).toHaveLength(21);
  });

  it.each(['error', 'follow'] as const)(
    'closes the connection of a redirect it refuses under redirect: %s',
    async (redirect) => {
      let closed = 0;
      const origin = net.createServer((socket) => {
        sockets.push(socket);
        socket.on('data', () => {
          // A redirect whose chunked body never ends.
          socket.write('HTTP/1.1 302 Found\r\nLocation: /again\r\nTransfer-Encoding: chunked\r\n\r\n');
          const stream = setInterval(() => socket.write('5\r\nchunk\r\n'), 5);
          socket.once('close', () => {
            clearInterval(stream);
            closed += 1;
          });
        });
      });
      const proxyUrl = await connectProxy(await listen(origin));

      await expect(createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://api.test/', { redirect })).rejects.toThrow(
        TypeError,
      );
      // One connection under redirect: error; the first and the 20 followed under redirect: follow.
      await expect.poll(() => closed).toBe(redirect === 'error' ? 1 : 21);
    },
  );

  it('fails a status the Response constructor refuses, closing the connection', async () => {
    let closed = false;
    const origin = net.createServer((socket) => {
      socket.once('data', () => {
        // Headers and the start of a chunked body: the connection stays open until the client ends it.
        socket.write('HTTP/1.1 999 Odd\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n');
      });
      socket.once('close', () => {
        closed = true;
      });
      sockets.push(socket);
    });
    const proxyUrl = await connectProxy(await listen(origin));

    const failure = createProxyAwareFetch({ HTTP_PROXY: proxyUrl })('http://api.test/');

    await expect(failure).rejects.toThrow(new TypeError('fetch failed'));
    await expect(failure).rejects.toHaveProperty('cause.name', 'RangeError');
    await expect.poll(() => closed).toBe(true);
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
