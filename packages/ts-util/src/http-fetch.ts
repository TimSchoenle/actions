/**
 * A `fetch` that honours the runner's proxy settings, for Octokit.
 *
 * Node's built-in `fetch` ignores `HTTPS_PROXY`. `@actions/github` worked around that by bundling
 * undici for its `ProxyAgent`, over 400 KB in every action. Here a request that goes direct — the
 * overwhelmingly common case — is handed to the built-in `fetch` unchanged, and only a request
 * `http-proxy.ts` routes through a proxy is carried by `http-request.ts` instead, which tunnels it
 * with a plain `CONNECT` and answers with a standard `Response`.
 */
import { pipeline, Readable, Transform } from 'node:stream';
import zlib from 'node:zlib';

import { getProxySettings } from './http-proxy.js';
import { httpRequest, REDIRECT_STATUSES } from './http-request.js';

import type { ProxyEnvironment } from './http-proxy.js';
import type { IncomingMessage } from 'node:http';

/** `fetch`'s own redirect limit, applied to the proxied path so both behave alike. */
const FETCH_MAX_REDIRECTS = 20;

/**
 * How long a proxied request's socket may sit idle: the 300 s undici gives the built-in `fetch` as
 * its headers and body timeouts, so a stalled proxy fails a request rather than holding the job.
 */
const IDLE_TIMEOUT_MS = 300_000;

/**
 * Statuses whose response has no body, which the `Response` constructor refuses one for. The 1xx
 * statuses are absent: Node never surfaces one as the final response.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** The encodings the proxied path asks for when the caller names none; all of them are decoded. */
const ACCEPT_ENCODING = 'gzip, deflate, br';

/** Decoder options that let a body cut short at a flush point decode what arrived, as `fetch` does. */
const ZLIB_OPTIONS: zlib.ZlibOptions = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };

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

/**
 * Decodes `Content-Encoding: deflate`, which servers send either zlib-wrapped, as the specification
 * says, or as a raw deflate stream. The first byte decides, as in `fetch`: a zlib header names the
 * deflate method (8) in its low four bits.
 */
class InflateStream extends Transform {
  #inflate: zlib.Inflate | zlib.InflateRaw | undefined;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (chunk.length === 0) {
      callback();

      return;
    }

    this.#inflate ??= this.#start(
      (chunk[0] & 0x0f) === 0x08 ? zlib.createInflate(ZLIB_OPTIONS) : zlib.createInflateRaw(ZLIB_OPTIONS),
    );

    if (this.#inflate.write(chunk)) {
      callback();
    } else {
      this.#inflate.once('drain', () => callback());
    }
  }

  override _flush(callback: (error?: Error | null) => void): void {
    if (this.#inflate === undefined) {
      callback();

      return;
    }

    this.#inflate.once('end', () => callback());
    this.#inflate.end();
  }

  override _read(size: number): void {
    this.#inflate?.resume();
    super._read(size);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.#inflate?.destroy();
    callback(error);
  }

  /** Forwards the decoder's output, pausing it while this stream's reader is not keeping up. */
  #start(inflate: zlib.Inflate | zlib.InflateRaw): zlib.Inflate | zlib.InflateRaw {
    inflate.on('data', (data: Buffer) => {
      if (!this.push(data)) {
        inflate.pause();
      }
    });
    inflate.once('error', (error) => this.destroy(error));

    return inflate;
  }
}

/** The decoder for a `Content-Encoding`, or `undefined` for one that is passed through as is. */
function decoder(encoding: string | undefined): NodeJS.ReadWriteStream | undefined {
  switch (encoding?.trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip': {
      return zlib.createGunzip(ZLIB_OPTIONS);
    }
    case 'deflate': {
      return new InflateStream();
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
  const parsed = new URL(url);
  if (parsed.username !== '' || parsed.password !== '') {
    throw new TypeError(`Request cannot be constructed from a URL that includes credentials: ${parsed.host}`);
  }

  // `Headers` lower-cases every name.
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  headers['accept-encoding'] ??= ACCEPT_ENCODING;

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

  // In both refusals below the redirect's body goes unread, and the connection is never reused: close it.
  if (redirect === 'error' && status >= 300 && status < 400 && message.headers.location !== undefined) {
    message.destroy();
    throw new TypeError(`fetch failed: ${url} redirected, and redirects were refused.`);
  }

  // `httpRequest` returns the last redirect once the limit is reached; `fetch` fails the request instead.
  if (redirect === 'follow' && REDIRECT_STATUSES.has(status) && message.headers.location !== undefined) {
    message.destroy();
    throw new TypeError('fetch failed', { cause: new Error('redirect count exceeded') });
  }

  const bodyless = method === 'HEAD' || NULL_BODY_STATUSES.has(status);
  if (bodyless) {
    message.resume();
  }

  let response: Response;
  try {
    response = new Response(bodyless ? null : (Readable.toWeb(decodedBody(message)) as ReadableStream), {
      status,
      statusText: message.statusMessage ?? '',
      headers: responseHeaders(message),
    });
  } catch (error) {
    // A status outside 200-599 or an invalid reason phrase; the unread body would hold the socket open.
    message.destroy();
    throw new TypeError('fetch failed', { cause: error });
  }

  // A constructed Response has an empty, read-only `url`; Octokit reads it for the response it returns.
  Object.defineProperty(response, 'url', { value: finalUrl });
  Object.defineProperty(response, 'redirected', { value: finalUrl !== parsed.href });

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
