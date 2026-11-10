/**
 * Which proxy, if any, a request has to go through, decided from the environment exactly as
 * `@actions/http-client` decided it — so a self-hosted runner configured for the toolkit keeps
 * working unchanged:
 *
 *  * `https_proxy`, then `HTTPS_PROXY`, for an `https:` URL; `http_proxy`, then `HTTP_PROXY`, for
 *    anything else. The lower-case name wins when both are set.
 *  * A loopback host never goes through a proxy: `localhost`, an IPv4 literal in 127.0.0.0/8, or
 *    `[::1]`. Stricter than `@actions/http-client`, which bypassed any host name starting with
 *    `127.` — so `127.example.com`, a public name, went direct there and goes through the proxy here.
 *  * `no_proxy`, then `NO_PROXY`, is a comma-separated list of hosts, matched case-insensitively
 *    against the host and against `host:port` (the port defaulting from the scheme). `*` matches
 *    everything; an entry matches the host itself and every subdomain of it; a leading `.` matches
 *    subdomains only.
 *  * Credentials in the proxy URL are percent-decoded and sent as `Proxy-Authorization: Basic`.
 */
import { isIPv4 } from 'node:net';

/** The environment variables this module reads, injectable so tests need not touch `process.env`. */
export type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

/** The proxy a request goes through. */
export interface ProxySettings {
  /** The proxy's URL, `http:` or `https:`, with any credentials still on it. */
  readonly url: URL;
  /** The `Proxy-Authorization` header value, when the proxy URL carries credentials. */
  readonly authorization: string | undefined;
}

/** Whether `host` (a URL hostname, IPv6 in brackets) is the local machine. */
function isLoopbackAddress(host: string): boolean {
  const lower = host.toLowerCase();

  return (
    lower === 'localhost' ||
    (isIPv4(lower) && lower.startsWith('127.')) ||
    lower === '[::1]' ||
    lower === '[0:0:0:0:0:0:0:1]'
  );
}

/** The port a URL connects to, explicit or implied by its scheme. */
function effectivePort(url: URL): number | undefined {
  if (url.port) {
    return Number(url.port);
  }

  if (url.protocol === 'http:') {
    return 80;
  }

  return url.protocol === 'https:' ? 443 : undefined;
}

/** Whether a request to `target` bypasses the proxy: a loopback host, or one `NO_PROXY` lists. */
export function checkBypass(target: URL, env: ProxyEnvironment = process.env): boolean {
  if (!target.hostname) {
    return false;
  }

  if (isLoopbackAddress(target.hostname)) {
    return true;
  }

  const noProxy = env.no_proxy || env.NO_PROXY || '';
  if (!noProxy) {
    return false;
  }

  const host = target.hostname.toUpperCase();
  const port = effectivePort(target);
  const candidates = port === undefined ? [host] : [host, `${host}:${port}`];

  return noProxy
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry !== '')
    .some(
      (entry) =>
        entry === '*' ||
        candidates.some(
          (candidate) =>
            candidate === entry ||
            candidate.endsWith(`.${entry}`) ||
            (entry.startsWith('.') && candidate.endsWith(entry)),
        ),
    );
}

/** `decodeURIComponent`, keeping the raw text when it is not valid percent-encoding. */
function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parses a proxy variable, or `undefined` for an `http://`/`https://` value that is not a URL at all,
 * which `@actions/http-client` ignored, sending the request direct.
 *
 * A value without a scheme (`proxy.internal:3128`) is taken as `http://`. The toolkit meant to do
 * the same, but `new URL` reads `proxy.internal:3128` as a URL with the scheme `proxy.internal:` and
 * no host, so it sent such requests nowhere useful. A value with any other scheme, or without a
 * host, is refused rather than sending the request somewhere the operator did not mean.
 */
function parseProxyUrl(value: string): URL | undefined {
  const hasHttpScheme = /^https?:\/\//i.test(value);
  const candidate = value.includes('://') ? value : `http://${value}`;
  let url: URL | undefined;

  try {
    url = new URL(candidate);
  } catch {
    if (hasHttpScheme) {
      return undefined;
    }
  }

  if (url === undefined || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') {
    throw new Error('The proxy URL in the environment is not a valid http:// or https:// URL.');
  }

  return url;
}

/**
 * The proxy a request to `target` goes through, or `undefined` when it goes direct.
 *
 * @throws when the applicable proxy variable is set to something that is not a proxy URL.
 */
export function getProxySettings(target: URL, env: ProxyEnvironment = process.env): ProxySettings | undefined {
  if (checkBypass(target, env)) {
    return undefined;
  }

  const value = target.protocol === 'https:' ? env.https_proxy || env.HTTPS_PROXY : env.http_proxy || env.HTTP_PROXY;
  if (!value) {
    return undefined;
  }

  const url = parseProxyUrl(value);
  if (url === undefined) {
    return undefined;
  }

  const username = decodeCredential(url.username);
  const password = decodeCredential(url.password);
  const authorization =
    username || password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : undefined;

  return { url, authorization };
}
