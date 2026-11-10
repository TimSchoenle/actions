/**
 * A `fetch` that honours the runner's proxy settings, for Octokit.
 *
 * Node's built-in `fetch` ignores `HTTPS_PROXY`. `@actions/github` worked around that by bundling
 * undici for its `ProxyAgent`, over 400 KB in every action. Here a request that goes direct — the
 * overwhelmingly common case — is handed to the built-in `fetch` unchanged, and only a request
 * `http-proxy.ts` routes through a proxy is carried by `http-request.ts` instead, which tunnels it
 * with a plain `CONNECT` and answers with a standard `Response`.
 */
import { pipeline, Readable } from 'node:stream';
import zlib from 'node:zlib';

import { getProxySettings } from './http-proxy.js';
import { httpRequest } from './http-request.js';

import type { ProxyEnvironment } from './http-proxy.js';
import type { IncomingMessage } from 'node:http';

/** `fetch`'s own redirect limit, applied to the proxied path so both behave alike. */
const FETCH_MAX_REDIRECTS = 20;

/**
 * How long a proxied request's socket may sit idle: the 300 s undici gives the built-in `fetch` as
 * its headers and body timeouts, so a stalled proxy fails a request rather than holding the job.
 */
const IDLE_TIMEOUT_MS = 300_000;

/** Statuses whose response has no body, which the `Response` constructor refuses one for. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** The `fetch` signature, narrowed to what Octokit passes. */
export type FetchFunction = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Converts a request body to what `http-request.ts` sends. Octokit only ever passes a string. */
function toBody(body: RequestInit['body']): string | Uint8Array | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === 'string' || body instanceof Uint8Array) {
    return body;
  }

  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }

  throw new TypeError('The proxied fetch only sends string and byte bodies.');
}

/** The decoder for a `Content-Encoding`, or `undefined` for one that is passed through as is. */
function decoder(encoding: string | undefined): NodeJS.ReadWriteStream | undefined {
  switch (encoding?.trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip': {
      return zlib.createGunzip({ flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH });
    }
    case 'deflate': {
      return zlib.createInflate({ flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH });
    }
    case 'br': {
      return zlib.createBrotliDecompress();
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Decodes the body the way `fetch` does, for the encodings Node can decode. Joined with `pipeline`,
 * so a connection cut mid-body errors the decoded stream instead of leaving it hanging.
 */
function decodedBody(message: IncomingMessage): Readable {
  const decode = decoder(message.headers['content-encoding']);

  if (decode === undefined) {
    return message;
  }

  return pipeline(message, decode, () => undefined) as unknown as Readable;
}

/** The response headers, repeated ones included, in the order they arrived. */
function responseHeaders(message: IncomingMessage): Headers {
  const headers = new Headers();

  for (let index = 0; index + 1 < message.rawHeaders.length; index += 2) {
    headers.append(message.rawHeaders[index], message.rawHeaders[index + 1]);
  }

  return headers;
}

/** Carries one request through `http-request.ts` and answers it as `fetch` would. */
async function fetchThroughProxy(url: string, init: RequestInit, env: ProxyEnvironment): Promise<Response> {
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });

  const method = (init.method ?? 'GET').toUpperCase();
  const redirect = init.redirect ?? 'follow';
  const { url: finalUrl, message } = await httpRequest(url, {
    method,
    headers,
    body: toBody(init.body),
    signal: init.signal ?? undefined,
    timeoutMs: IDLE_TIMEOUT_MS,
    maxRedirects: redirect === 'follow' ? FETCH_MAX_REDIRECTS : 0,
    env,
  });
  const status = message.statusCode ?? 0;

  if (redirect === 'error' && status >= 300 && status < 400 && message.headers.location !== undefined) {
    message.resume();
    throw new TypeError(`fetch failed: ${url} redirected, and redirects were refused.`);
  }

  const bodyless = method === 'HEAD' || NULL_BODY_STATUSES.has(status);
  if (bodyless) {
    message.resume();
  }

  const response = new Response(bodyless ? null : (Readable.toWeb(decodedBody(message)) as ReadableStream), {
    status,
    statusText: message.statusMessage ?? '',
    headers: responseHeaders(message),
  });

  // A constructed Response has an empty, read-only `url`; Octokit reads it for the response it returns.
  Object.defineProperty(response, 'url', { value: finalUrl });
  Object.defineProperty(response, 'redirected', { value: finalUrl !== new URL(url).href });

  return response;
}

/**
 * Creates a `fetch` that goes direct through `nativeFetch` unless a proxy applies to the URL.
 *
 * Only a string or `URL` input is accepted, which is all Octokit passes.
 */
export function createProxyAwareFetch(
  env: ProxyEnvironment = process.env,
  nativeFetch: FetchFunction = globalThis.fetch,
): FetchFunction {
  return async (input, init = {}) => {
    const url = input instanceof URL ? input.href : input;

    if (getProxySettings(new URL(url), env) === undefined) {
      return nativeFetch(input, init);
    }

    return fetchThroughProxy(url, init, env);
  };
}
