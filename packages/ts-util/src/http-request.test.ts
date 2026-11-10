import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { httpRequest, readBody } from './http-request.js';

import type { AddressInfo } from 'node:net';

/** A self-signed certificate for `secure.test` and 127.0.0.1, made for this run, or none without openssl. */
function makeCertificate(): { key: string; cert: string } | undefined {
  const directory = mkdtempSync(path.join(tmpdir(), 'http-request-cert-'));

  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=secure.test',
        '-addext',
        'subjectAltName=DNS:secure.test,IP:127.0.0.1',
        '-keyout',
        path.join(directory, 'key.pem'),
        '-out',
        path.join(directory, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );

    return {
      key: readFileSync(path.join(directory, 'key.pem'), 'utf8'),
      cert: readFileSync(path.join(directory, 'cert.pem'), 'utf8'),
    };
  } catch {
    return undefined;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const certificate = makeCertificate();
const servers: net.Server[] = [];
/** Tunnelled sockets, which the proxy server no longer tracks once the tunnel is open. */
const tunnelSockets: net.Socket[] = [];

async function listen<T extends net.Server>(server: T): Promise<{ server: T; port: number }> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return { server, port: (server.address() as AddressInfo).port };
}

afterEach(async () => {
  for (const socket of tunnelSockets.splice(0)) {
    socket.destroy();
  }

  for (const server of servers.splice(0)) {
    (server as http.Server).closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

/** What a test origin saw of one request. */
interface Seen {
  method: string | undefined;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** An origin answering with `handler`, recording every request it receives. */
function origin(
  handler: (request: http.IncomingMessage, response: http.ServerResponse, seen: Seen) => void,
  secure = false,
): { server: http.Server; seen: Seen[] } {
  const seen: Seen[] = [];
  const onRequest = (request: http.IncomingMessage, response: http.ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const entry = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      };
      seen.push(entry);
      handler(request, response, entry);
    });
  };
  const server = secure ? https.createServer({ ...certificate }, onRequest) : http.createServer(onRequest);

  return { server, seen };
}

/** A `CONNECT` proxy that sends every tunnel to `targetPort` on 127.0.0.1, whatever host was asked for. */
function connectProxy(
  targetPort: () => number,
  options: { secure?: boolean; requireAuthorization?: string } = {},
): { server: http.Server; tunnels: { authority: string | undefined; authorization: string | undefined }[] } {
  const tunnels: { authority: string | undefined; authorization: string | undefined }[] = [];
  const server = options.secure ? https.createServer({ ...certificate }) : http.createServer();

  server.on('request', (_request, response: http.ServerResponse) => {
    response.writeHead(405).end();
  });
  server.on('connect', (request: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const authorization = request.headers['proxy-authorization'];
    tunnels.push({ authority: request.url, authorization });

    if (options.requireAuthorization !== undefined && authorization !== options.requireAuthorization) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');

      return;
    }

    tunnelSockets.push(socket);
    const upstream = net.connect(targetPort(), '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    tunnelSockets.push(upstream);
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return { server, tunnels };
}

async function text(url: string, options: Parameters<typeof httpRequest>[1] = {}): Promise<string> {
  const { message } = await httpRequest(url, options);

  return (await readBody(message)).toString();
}

describe('httpRequest through a proxy', () => {
  it('tunnels an http:// request with CONNECT and authenticates to the proxy only', async () => {
    const target = origin((_request, response) => response.end('plain payload'));
    const { port } = await listen(target.server);
    const proxy = connectProxy(() => port, {
      requireAuthorization: `Basic ${Buffer.from('u@x:p').toString('base64')}`,
    });
    const { port: proxyPort } = await listen(proxy.server);

    const body = await text('http://plain.test/file?q=1', {
      env: { HTTP_PROXY: `http://u%40x:p@127.0.0.1:${proxyPort}` },
      headers: { 'X-Test': 'yes' },
    });

    expect(body).toBe('plain payload');
    expect(proxy.tunnels).toEqual([{ authority: 'plain.test:80', authorization: 'Basic dUB4OnA=' }]);
    expect(target.seen[0]).toMatchObject({ url: '/file?q=1', headers: { host: 'plain.test', 'x-test': 'yes' } });
    expect(target.seen[0]?.headers['proxy-authorization']).toBeUndefined();
  });

  it('hands the tunnel over to the request, whose own timeout then applies', async () => {
    const target = origin((_request, response) => {
      response.writeHead(200, { 'Content-Length': '4' });
      response.write('sl');
      setTimeout(() => response.end('ow'), 150);
    });
    const { port } = await listen(target.server);
    const proxy = connectProxy(() => port);
    const { port: proxyPort } = await listen(proxy.server);

    await expect(
      text('http://plain.test/', { timeoutMs: 400, env: { HTTP_PROXY: `http://127.0.0.1:${proxyPort}` } }),
    ).resolves.toBe('slow');
    // Past the timeout: a timer left on the tunnel would now fire against a settled request.
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it('fails a proxied request whose origin stops answering, naming the request', async () => {
    const target = origin(() => undefined);
    const { port } = await listen(target.server);
    const proxy = connectProxy(() => port);
    const { port: proxyPort } = await listen(proxy.server);

    await expect(
      httpRequest('http://plain.test/hang', { timeoutMs: 150, env: { HTTP_PROXY: `http://127.0.0.1:${proxyPort}` } }),
    ).rejects.toThrow('Request timeout: http://plain.test/hang');
  });

  it('fails with the status when the proxy refuses the tunnel', async () => {
    const proxy = connectProxy(() => 1, { requireAuthorization: 'Basic other' });
    const { port: proxyPort } = await listen(proxy.server);

    await expect(
      httpRequest('http://plain.test/', { env: { HTTP_PROXY: `http://127.0.0.1:${proxyPort}` } }),
    ).rejects.toThrow('The proxy refused to open a tunnel to plain.test:80: it answered 407.');
  });

  it('fails when the proxy cannot be reached', async () => {
    const { server, port } = await listen(net.createServer());
    await new Promise((resolve) => server.close(resolve));
    servers.splice(servers.indexOf(server), 1);

    await expect(
      httpRequest('http://plain.test/', { env: { HTTP_PROXY: `http://127.0.0.1:${port}` } }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it('goes direct for a host NO_PROXY lists', async () => {
    const target = origin((_request, response) => response.end('direct'));
    const { port } = await listen(target.server);

    // 127.0.0.1 is loopback and never proxied; the bogus proxy proves it is not even contacted.
    await expect(text(`http://127.0.0.1:${port}/`, { env: { HTTP_PROXY: 'http://127.0.0.1:1' } })).resolves.toBe(
      'direct',
    );
  });

  describe.skipIf(certificate === undefined)('with TLS', () => {
    let restoreCertificates: (() => void) | undefined;

    beforeAll(() => {
      const defaults = tls.getCACertificates('default');
      tls.setDefaultCACertificates([...defaults, certificate!.cert]);
      restoreCertificates = () => tls.setDefaultCACertificates(defaults);
    });

    afterAll(() => restoreCertificates?.());

    it('starts TLS inside the tunnel for an https:// request, verifying the origin by its name', async () => {
      const target = origin((_request, response) => response.end('secure payload'), true);
      const { port } = await listen(target.server);
      const proxy = connectProxy(() => port);
      const { port: proxyPort } = await listen(proxy.server);

      const body = await text('https://secure.test/asset', { env: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` } });

      expect(body).toBe('secure payload');
      expect(proxy.tunnels).toEqual([{ authority: 'secure.test:443', authorization: undefined }]);
      expect(target.seen[0]?.headers.host).toBe('secure.test');
    });

    it('refuses an origin whose certificate does not match the requested name', async () => {
      const target = origin((_request, response) => response.end('never'), true);
      const { port } = await listen(target.server);
      const proxy = connectProxy(() => port);
      const { port: proxyPort } = await listen(proxy.server);

      await expect(
        httpRequest('https://impostor.test/', { env: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` } }),
      ).rejects.toThrow(/altnames|certificate/i);
      expect(target.seen).toEqual([]);
    });

    it('reaches an https:// proxy over TLS', async () => {
      const target = origin((_request, response) => response.end('via tls proxy'));
      const { port } = await listen(target.server);
      const proxy = connectProxy(() => port, { secure: true });
      const { port: proxyPort } = await listen(proxy.server);

      await expect(text('http://plain.test/', { env: { HTTP_PROXY: `https://127.0.0.1:${proxyPort}` } })).resolves.toBe(
        'via tls proxy',
      );
      expect(proxy.tunnels).toHaveLength(1);
    });

    it('refuses to follow a redirect from https:// down to http://', async () => {
      const target = origin(
        (_request, response) => response.writeHead(302, { Location: 'http://127.0.0.1:1/' }).end(),
        true,
      );
      const { port } = await listen(target.server);

      await expect(httpRequest(`https://127.0.0.1:${port}/`, { env: {} })).rejects.toThrow(
        'Redirect from HTTPS to HTTP protocol. This downgrade is not allowed for security reasons.',
      );
    });
  });
});

describe('httpRequest redirects', () => {
  it('follows a relative Location and reports the final URL', async () => {
    const target = origin((request, response) => {
      if (request.url === '/start') {
        response.writeHead(301, { Location: '/end' }).end();
      } else {
        response.end('done');
      }
    });
    const { port } = await listen(target.server);

    const { url, message } = await httpRequest(`http://127.0.0.1:${port}/start`, { env: {} });

    expect(url).toBe(`http://127.0.0.1:${port}/end`);
    expect((await readBody(message)).toString()).toBe('done');
  });

  it('turns a POST into a bodiless GET on 303, and keeps method and body on 307', async () => {
    const target = origin((request, response) => {
      if (request.url === '/see-other') {
        response.writeHead(303, { Location: '/landing' }).end();
      } else if (request.url === '/temporary') {
        response.writeHead(307, { Location: '/landing' }).end();
      } else {
        response.end();
      }
    });
    const { port } = await listen(target.server);
    const post = { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' }, env: {} };

    await (await httpRequest(`http://127.0.0.1:${port}/see-other`, post)).message.resume();
    await (await httpRequest(`http://127.0.0.1:${port}/temporary`, post)).message.resume();

    await expect.poll(() => target.seen.length).toBe(4);
    expect(target.seen[1]).toMatchObject({ method: 'GET', url: '/landing', body: '' });
    expect(target.seen[1]?.headers['content-type']).toBeUndefined();
    expect(target.seen[3]).toMatchObject({ method: 'POST', url: '/landing', body: '{"a":1}' });
  });

  it('keeps credentials on the same origin and drops them on another', async () => {
    const other = origin((_request, response) => response.end());
    const { port: otherPort } = await listen(other.server);
    const first = origin((request, response) => {
      if (request.url === '/same') {
        response.writeHead(302, { Location: '/elsewhere' }).end();
      } else if (request.url === '/elsewhere') {
        response.writeHead(302, { Location: `http://localhost:${otherPort}/storage` }).end();
      } else {
        response.end();
      }
    });
    const { port } = await listen(first.server);

    await (
      await httpRequest(`http://127.0.0.1:${port}/same`, {
        headers: { Authorization: 'Bearer secret', Cookie: 'c=1', Accept: 'x/y' },
        env: {},
      })
    ).message.resume();

    expect(first.seen.map((entry) => entry.headers.authorization)).toEqual(['Bearer secret', 'Bearer secret']);
    expect(other.seen[0]?.headers.authorization).toBeUndefined();
    expect(other.seen[0]?.headers.cookie).toBeUndefined();
    expect(other.seen[0]?.headers.accept).toBe('x/y');
  });

  it('returns the redirect itself once the redirects run out, and follows none when told to', async () => {
    const target = origin((_request, response) => response.writeHead(302, { Location: '/again' }).end());
    const { port } = await listen(target.server);

    const exhausted = await httpRequest(`http://127.0.0.1:${port}/`, { maxRedirects: 2, env: {} });
    exhausted.message.resume();
    const unfollowed = await httpRequest(`http://127.0.0.1:${port}/`, { maxRedirects: 0, env: {} });
    unfollowed.message.resume();

    expect(exhausted.message.statusCode).toBe(302);
    expect(unfollowed.message.statusCode).toBe(302);
    expect(target.seen).toHaveLength(4);
  });

  it('returns a redirect without a Location as it is', async () => {
    const target = origin((_request, response) => response.writeHead(302).end('no location'));
    const { port } = await listen(target.server);

    const { message } = await httpRequest(`http://127.0.0.1:${port}/`, { env: {} });

    expect(message.statusCode).toBe(302);
    expect((await readBody(message)).toString()).toBe('no location');
  });
});

describe('httpRequest failures', () => {
  it('fails a request whose socket goes idle', async () => {
    const target = origin(() => undefined);
    const { port } = await listen(target.server);

    await expect(httpRequest(`http://127.0.0.1:${port}/slow`, { timeoutMs: 100, env: {} })).rejects.toThrow(
      `Request timeout: http://127.0.0.1:${port}/slow`,
    );
  });

  it('aborts on the signal', async () => {
    const target = origin(() => undefined);
    const { port } = await listen(target.server);

    await expect(
      httpRequest(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(50), env: {} }),
    ).rejects.toThrow(/abort/i);
  });

  it('refuses a protocol other than http and https', async () => {
    await expect(httpRequest('file:///etc/passwd')).rejects.toThrow('Unsupported protocol file:');
  });

  it('resolves an error status rather than throwing', async () => {
    const target = origin((_request, response) => response.writeHead(503).end('down'));
    const { port } = await listen(target.server);

    const { message } = await httpRequest(`http://127.0.0.1:${port}/`, { env: {} });

    expect(message.statusCode).toBe(503);
    message.resume();
  });
});
