import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';

import { checkBypass, getProxySettings } from './http-proxy.js';

// An `xn--` label must be valid Punycode, or `new URL` refuses the host; such labels are left out.
const label = fc.stringMatching(/^[a-z][a-z\d-]{0,10}$/).filter((value) => !value.startsWith('xn--'));
const domain = fc.array(label, { minLength: 2, maxLength: 4 }).map((labels) => labels.join('.'));
const scheme = fc.constantFrom('http', 'https');

describe('proxy selection properties', () => {
  it.prop([scheme, domain, fc.array(domain)])(
    'bypasses a host NO_PROXY lists, and every subdomain of it',
    (protocol, host, others) => {
      const noProxy = [...others, host].join(',');

      expect(checkBypass(new URL(`${protocol}://${host}/`), { NO_PROXY: noProxy })).toBe(true);
      expect(checkBypass(new URL(`${protocol}://sub.${host}/`), { NO_PROXY: noProxy })).toBe(true);
    },
  );

  it.prop([scheme, domain])('does not bypass a host that merely ends with a listed name', (protocol, entry) => {
    expect(checkBypass(new URL(`${protocol}://not${entry}/`), { NO_PROXY: entry })).toBe(false);
  });

  it.prop([scheme, domain, fc.constantFrom('', '*', 'example.com')])(
    'always bypasses loopback',
    (protocol, _host, noProxy) => {
      for (const loopback of ['localhost', '127.0.0.1', '[::1]']) {
        expect(
          getProxySettings(new URL(`${protocol}://${loopback}/`), {
            HTTP_PROXY: 'http://p',
            HTTPS_PROXY: 'http://p',
            NO_PROXY: noProxy,
          }),
        ).toBeUndefined();
      }
    },
  );

  it.prop([scheme, domain, fc.string(), fc.string()])(
    'turns any credentials into a Basic header that decodes back to them',
    (protocol, host, user, password) => {
      fc.pre(user !== '' || password !== '');
      const proxy = `http://${encodeURIComponent(user)}:${encodeURIComponent(password)}@proxy.internal:3128`;
      const settings = getProxySettings(new URL(`${protocol}://${host}/`), { HTTP_PROXY: proxy, HTTPS_PROXY: proxy });

      expect(Buffer.from(settings?.authorization?.slice('Basic '.length) ?? '', 'base64').toString()).toBe(
        `${user}:${password}`,
      );
    },
  );
});
