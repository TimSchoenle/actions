import { describe, expect, it } from 'vitest';

import { checkBypass, getProxySettings } from './http-proxy.js';

const HTTPS_TARGET = new URL('https://api.github.com/repos/o/r');
const HTTP_TARGET = new URL('http://example.com/file');

describe('getProxySettings', () => {
  it('goes direct when no proxy is configured', () => {
    expect(getProxySettings(HTTPS_TARGET, {})).toBeUndefined();
  });

  it('picks the proxy variable by the scheme of the request', () => {
    const env = { HTTPS_PROXY: 'http://secure-proxy:3128', HTTP_PROXY: 'http://plain-proxy:3128' };

    expect(getProxySettings(HTTPS_TARGET, env)?.url.host).toBe('secure-proxy:3128');
    expect(getProxySettings(HTTP_TARGET, env)?.url.host).toBe('plain-proxy:3128');
  });

  it('does not fall back from one scheme to the other', () => {
    expect(getProxySettings(HTTPS_TARGET, { HTTP_PROXY: 'http://plain-proxy' })).toBeUndefined();
    expect(getProxySettings(HTTP_TARGET, { HTTPS_PROXY: 'http://secure-proxy' })).toBeUndefined();
  });

  it('prefers the lower-case variable', () => {
    const env = { https_proxy: 'http://lower:1', HTTPS_PROXY: 'http://upper:2' };

    expect(getProxySettings(HTTPS_TARGET, env)?.url.hostname).toBe('lower');
  });

  it('falls back to the upper-case variable when the lower-case one is empty', () => {
    expect(getProxySettings(HTTPS_TARGET, { https_proxy: '', HTTPS_PROXY: 'http://upper' })?.url.hostname).toBe(
      'upper',
    );
  });

  it('reads a proxy without a scheme as http://', () => {
    const proxy = getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'proxy.internal:3128' });

    expect(proxy?.url.href).toBe('http://proxy.internal:3128/');
  });

  it('keeps an https:// proxy', () => {
    expect(getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'https://proxy' })?.url.protocol).toBe('https:');
  });

  it('refuses a proxy value with another scheme', () => {
    expect(() => getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'ftp://proxy' })).toThrow(/not a valid http/);
    expect(() => getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'socks5://proxy:1080' })).toThrow(/not a valid http/);
  });

  it('goes direct for an http:// value that is not a URL at all, as @actions/http-client did', () => {
    expect(getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'http://' })).toBeUndefined();
    expect(getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'http://[bad' })).toBeUndefined();
  });

  it('turns credentials into a decoded Basic Proxy-Authorization', () => {
    const proxy = getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'http://us%40er:p%3Ass%25@proxy:8080' });

    expect(proxy?.authorization).toBe(`Basic ${Buffer.from('us@er:p:ss%').toString('base64')}`);
  });

  it('authenticates with a user name alone', () => {
    expect(getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'http://user@proxy' })?.authorization).toBe(
      `Basic ${Buffer.from('user:').toString('base64')}`,
    );
  });

  it('sends no Proxy-Authorization without credentials', () => {
    expect(getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'http://proxy' })?.authorization).toBeUndefined();
  });

  it('keeps credentials that are not valid percent-encoding as they are', () => {
    expect(getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'http://us%zzer:pw@proxy' })?.authorization).toBe(
      `Basic ${Buffer.from('us%zzer:pw').toString('base64')}`,
    );
  });

  it('goes direct for a host NO_PROXY lists', () => {
    expect(getProxySettings(HTTPS_TARGET, { HTTPS_PROXY: 'http://proxy', NO_PROXY: 'github.com' })).toBeUndefined();
  });
});

describe('checkBypass', () => {
  const bypassed = (url: string, noProxy: string | undefined): boolean =>
    checkBypass(new URL(url), { NO_PROXY: noProxy });

  it.each([
    'http://localhost/x',
    'http://LOCALHOST:8080/',
    'http://127.0.0.1/',
    'http://127.1.2.3:9/',
    'http://127.1/',
    'http://[::1]/',
    'http://[0:0:0:0:0:0:0:1]/',
  ])('always bypasses the loopback host %s', (url) => {
    expect(bypassed(url, undefined)).toBe(true);
  });

  it('does not treat a host that merely starts with "localhost" as loopback', () => {
    expect(bypassed('http://localhost.example.com/', undefined)).toBe(false);
  });

  it.each(['http://127.evil.example/', 'http://127.0.0.1.example.com/'])(
    'does not treat the host name %s, which only starts with "127", as loopback',
    (url) => {
      expect(bypassed(url, undefined)).toBe(false);
    },
  );

  it('bypasses nothing else without NO_PROXY', () => {
    expect(bypassed('https://github.com/', undefined)).toBe(false);
    expect(bypassed('https://github.com/', '')).toBe(false);
  });

  it('bypasses everything for *', () => {
    expect(bypassed('https://github.com/', '*')).toBe(true);
  });

  it('matches a host and its subdomains, case-insensitively', () => {
    expect(bypassed('https://github.com/', 'GitHub.com')).toBe(true);
    expect(bypassed('https://api.github.com/', 'github.com')).toBe(true);
    expect(bypassed('https://notgithub.com/', 'github.com')).toBe(false);
  });

  it('matches only subdomains for an entry with a leading dot', () => {
    expect(bypassed('https://api.github.com/', '.github.com')).toBe(true);
    expect(bypassed('https://github.com/', '.github.com')).toBe(false);
  });

  it('matches host:port with the port defaulting from the scheme', () => {
    expect(bypassed('https://github.com/', 'github.com:443')).toBe(true);
    expect(bypassed('http://github.com/', 'github.com:80')).toBe(true);
    expect(bypassed('https://github.com/', 'github.com:80')).toBe(false);
    expect(bypassed('https://github.com:8443/', 'github.com:8443')).toBe(true);
  });

  it('reads a comma-separated list, ignoring blanks and surrounding spaces', () => {
    expect(bypassed('https://ghe.internal/', ' example.com , , ghe.internal ')).toBe(true);
    expect(bypassed('https://github.com/', ' example.com , , ghe.internal ')).toBe(false);
  });

  it('prefers the lower-case no_proxy', () => {
    expect(checkBypass(new URL('https://github.com/'), { no_proxy: 'example.com', NO_PROXY: 'github.com' })).toBe(
      false,
    );
  });
});
