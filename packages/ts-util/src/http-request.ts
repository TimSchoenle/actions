/**
 * A minimal HTTP client on `node:http`/`node:https` that honours the runner's proxy settings.
 *
 * It replaces `@actions/http-client` (and through it undici and `tunnel`) for the two things this
 * repository needs: streaming a release asset to disk, and — via `http-fetch.ts` — carrying Octokit's
 * requests when a proxy applies. Node's own `fetch` ignores `HTTPS_PROXY`, which is what kept the
 * toolkit client in every bundle.
 *
 * Behaviour kept from `@actions/http-client`:
 *  * the proxy is chosen per request by `http-proxy.ts`, with the toolkit's `NO_PROXY` rules;
 *  * a proxied request, `http:` or `https:`, is tunnelled through an HTTP `CONNECT` — to the proxy
 *    over TLS when the proxy URL is `https:` — and authenticates with the URL's credentials;
 *  * redirects are followed (up to 50), an `https:` → `http:` downgrade is refused, and running out
 *    of redirects returns the last redirect response rather than throwing;
 *  * connections are not kept alive, so nothing holds the process open after the last request;
 *  * the socket timeout fails the request with an error naming the URL.
 *
 * Stricter than `@actions/http-client`: `Authorization` and `Cookie` are dropped on a redirect to
 * another *origin* (it compared host names only), a relative `Location` is resolved against the
 * request URL (it threw), and a `303` — or a `301`/`302` answering a `POST` — is followed with a
 * bodiless `GET`, as `fetch` does.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

import { getProxySettings } from './http-proxy.js';

import type { ProxyEnvironment, ProxySettings } from './http-proxy.js';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/** Redirect statuses that are followed. */
const REDIRECT_STATUSES = new Set([300, 301, 302, 303, 307, 308]);

/** Redirects followed before the redirect response itself is returned, as in `@actions/http-client`. */
export const DEFAULT_MAX_REDIRECTS = 50;

/** Request headers that carry a credential for the origin they were sent to, and no further. */
const ORIGIN_CREDENTIAL_HEADERS = new Set(['authorization', 'cookie']);

/** Request headers that describe a body, dropped with it when a redirect turns the request into a `GET`. */
const BODY_HEADERS = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'content-language',
  'transfer-encoding',
]);

/** One HTTP request. */
export interface HttpRequestOptions {
  /** The method; `GET` by default. */
  readonly method?: string;
  /** Request headers. Names are matched case-insensitively. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The request body. */
  readonly body?: string | Uint8Array;
  /** Fails the request when its socket is idle this long. Unset waits indefinitely. */
  readonly timeoutMs?: number;
  /** Aborts the request. */
  readonly signal?: AbortSignal;
  /** Redirects to follow; {@link DEFAULT_MAX_REDIRECTS} by default, `0` to follow none. */
  readonly maxRedirects?: number;
  /** Where the proxy variables are read from; `process.env` by default. */
  readonly env?: ProxyEnvironment;
}

/** A response whose body has not been read yet. */
export interface HttpResponse {
  /** The URL that answered, after redirects. */
  readonly url: string;
  /** The response, its body still to be consumed (or `resume()`d to discard it). */
  readonly message: IncomingMessage;
}

/** Strips the brackets a URL puts around an IPv6 literal, which `net` and `tls` do not take. */
function bareHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function defaultPort(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

/**
 * Opens a `CONNECT` tunnel to `host:port` through `proxy`, resolving with the raw socket once the
 * proxy has answered 200.
 */
export function openTunnel(
  proxy: ProxySettings,
  host: string,
  port: number,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<Duplex> {
  const authority = `${net.isIPv6(host) ? `[${host}]` : host}:${port}`;
  const headers: Record<string, string> = { host: authority };

  if (proxy.authorization !== undefined) {
    headers['proxy-authorization'] = proxy.authorization;
  }

  const proxyHost = bareHost(proxy.url.hostname);
  const proxyPort = proxy.url.port ? Number(proxy.url.port) : defaultPort(proxy.url.protocol);
  const overTls = proxy.url.protocol === 'https:';
  const options: http.RequestOptions = {
    host: proxyHost,
    port: proxyPort,
    method: 'CONNECT',
    path: authority,
    headers,
    signal,
    // TLS to an https:// proxy is opened here, so it is verified against the proxy's own name rather
    // than the tunnel's `Host` header, which names the origin. Node uses `createConnection` only
    // when no agent is given; a plain connection gets a fresh agent, so neither is pooled.
    ...(overTls
      ? {
          createConnection: () =>
            tls.connect({ host: proxyHost, port: proxyPort, servername: net.isIP(proxyHost) ? undefined : proxyHost }),
        }
      : { agent: false }),
  };

  return new Promise((resolve, reject) => {
    const request = http.request(options);

    request.once(
      'connect',
      (response: IncomingMessage, socket: Duplex & { setTimeout?: (ms: number) => void }, head: Buffer) => {
        if (response.statusCode === 200) {
          // The tunnel's own timeout ends here: from now on the socket belongs to the request riding
          // it, which sets its own. Anything the proxy sent past its answer belongs to that request too.
          request.removeAllListeners('timeout');
          socket.setTimeout?.(0);
          if (head.length > 0) {
            socket.unshift(head);
          }

          resolve(socket);

          return;
        }

        socket.destroy();
        reject(new Error(`The proxy refused to open a tunnel to ${authority}: it answered ${response.statusCode}.`));
      },
    );
    request.once('error', reject);

    if (timeoutMs !== undefined) {
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`The proxy did not open a tunnel to ${authority} within ${timeoutMs / 1000}s.`));
      });
    }

    request.end();
  });
}

/** The agent options Node hands to `createConnection`, as far as this module reads them. */
type ConnectionOptions = tls.ConnectionOptions & { host?: string | null; port?: number | string | null };

type ConnectionCallback = (error: Error | null, socket?: Duplex) => void;

/**
 * An agent that reaches every origin through a `CONNECT` tunnel, starting TLS inside the tunnel for
 * an `https:` origin. One per request, never kept alive.
 */
function tunnelAgent(proxy: ProxySettings, target: URL, timeoutMs?: number, signal?: AbortSignal): http.Agent {
  const host = bareHost(target.hostname);
  const port = target.port ? Number(target.port) : defaultPort(target.protocol);
  const secure = target.protocol === 'https:';
  const Base = secure ? https.Agent : http.Agent;

  class TunnelAgent extends Base {
    override createConnection(options: ConnectionOptions, callback: ConnectionCallback): undefined {
      openTunnel(proxy, host, port, timeoutMs, signal).then(
        (socket) => {
          if (!secure) {
            callback(null, socket);

            return;
          }

          callback(
            null,
            tls.connect({
              ...options,
              socket,
              host,
              port,
              servername: net.isIP(host) ? undefined : (options.servername ?? host),
            }),
          );
        },
        (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
      );

      return undefined;
    }
  }

  return new TunnelAgent({ keepAlive: false });
}

/** Lower-cases header names, so the redirect logic can drop headers by name. */
function normaliseHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const normalised: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers ?? {})) {
    normalised[name.toLowerCase()] = value;
  }

  return normalised;
}

/** One request, without following redirects. */
function send(
  url: URL,
  method: string,
  headers: Readonly<Record<string, string>>,
  body: string | Uint8Array | undefined,
  options: HttpRequestOptions,
): Promise<IncomingMessage> {
  const proxy = getProxySettings(url, options.env);
  const secure = url.protocol === 'https:';
  const agent = proxy === undefined ? false : tunnelAgent(proxy, url, options.timeoutMs, options.signal);

  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(url, { method, headers, agent, signal: options.signal });

    request.once('response', resolve);
    request.once('error', reject);

    if (options.timeoutMs !== undefined) {
      request.setTimeout(options.timeoutMs, () => {
        request.destroy(new Error(`Request timeout: ${url.origin}${url.pathname}`));
      });
    }

    request.end(body);
  });
}

/**
 * Sends a request and resolves with its response once the headers arrive, following redirects.
 *
 * Rejects only when no response arrived: a refused or timed-out connection, a proxy that would not
 * tunnel, an abort, or a refused downgrade. Any status, an error status included, resolves.
 */
export async function httpRequest(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
  let current = new URL(url);
  let method = (options.method ?? 'GET').toUpperCase();
  let headers = normaliseHeaders(options.headers);
  let body = options.body;
  let redirectsLeft = Math.max(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS, 0);

  for (;;) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error(`Unsupported protocol ${current.protocol} in ${current.origin}.`);
    }

    const message = await send(current, method, headers, body, options);
    const location = message.headers.location;

    if (!REDIRECT_STATUSES.has(message.statusCode ?? 0) || location === undefined || redirectsLeft <= 0) {
      return { url: current.href, message };
    }

    // The redirect's own body is not needed; draining it frees the socket.
    message.resume();

    const next = new URL(location, current);
    if (current.protocol === 'https:' && next.protocol === 'http:') {
      throw new Error('Redirect from HTTPS to HTTP protocol. This downgrade is not allowed for security reasons.');
    }

    if (next.origin !== current.origin) {
      headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !ORIGIN_CREDENTIAL_HEADERS.has(name)));
    }

    const status = message.statusCode ?? 0;
    if ((status === 303 && method !== 'HEAD') || ((status === 301 || status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
      headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !BODY_HEADERS.has(name)));
    }

    current = next;
    redirectsLeft -= 1;
  }
}

/** Reads a whole response body. */
export async function readBody(message: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of message) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks);
}
