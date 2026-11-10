import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiBaseUrl, getOctokit, getUserAgentWithOrchestrationId, REST_ROUTES } from './octokit.js';

/** A fetch answering every request with `body`, recording what it was asked. */
function fakeFetch(
  respond: (url: string) => { body: unknown; headers?: Record<string, string> } = () => ({ body: {} }),
) {
  return vi.fn((url: string) => {
    const { body, headers } = respond(url);

    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } }),
    );
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('REST_ROUTES', () => {
  const reference = restEndpointMethods(new Octokit()).rest as unknown as Record<
    string,
    Record<string, { endpoint: { DEFAULTS: { method: string; url: string } } }>
  >;

  const routes = Object.entries(REST_ROUTES).flatMap(([scope, methods]) =>
    Object.entries(methods).map(([name, route]) => ({ scope, name, route: route as string })),
  );

  /**
   * The plugin's own endpoint table, `[route, defaults?, decorations?]` per method. It is not among
   * the package's exports, so it is loaded from the file next to the entry point.
   */
  const endpointTable = (async () => {
    const entry = createRequire(import.meta.url).resolve('@octokit/plugin-rest-endpoint-methods');
    const table = pathToFileURL(path.join(path.dirname(entry), 'generated', 'endpoints.js')).href;

    return ((await import(table)) as { default: Record<string, Record<string, readonly unknown[]>> }).default;
  })();

  it.each(routes)(
    'routes $scope.$name exactly as @octokit/plugin-rest-endpoint-methods does',
    ({ scope, name, route }) => {
      const { method, url } = reference[scope][name].endpoint.DEFAULTS;

      expect(route).toBe(`${method} ${url}`);
    },
  );

  // `restEndpoints` builds every method from its route alone; an endpoint the plugin gives defaults
  // (such as another `baseUrl`) or decorations (`mapToData`, `renamed`, ...) would need more.
  it.each(routes)('finds neither defaults nor decorations on $scope.$name in the plugin', async ({ scope, name }) => {
    const entry = (await endpointTable)[scope]?.[name];

    expect(entry).toBeDefined();
    expect(entry?.slice(1).filter((part) => part !== undefined && Object.keys(part as object).length > 0)).toEqual([]);
  });

  it('builds methods the pagination plugin can follow', async () => {
    const fetch = fakeFetch((url) =>
      url.includes('page=2')
        ? { body: [{ number: 2 }] }
        : { body: [{ number: 1 }], headers: { link: '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"' } },
    );
    const octokit = getOctokit('t', { request: { fetch } });

    const pulls = await octokit.paginate(octokit.rest.pulls.list, { owner: 'o', repo: 'r' });

    expect(pulls.map((pull) => pull.number)).toEqual([1, 2]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/o/r/pulls',
      'https://api.github.com/repos/o/r/pulls?page=2',
    ]);
  });
});

describe('getOctokit', () => {
  it('authenticates with the token against GITHUB_API_URL', async () => {
    vi.stubEnv('GITHUB_API_URL', 'https://ghe.example.com/api/v3');
    vi.stubEnv('ACTIONS_ORCHESTRATION_ID', 'run 1/2');
    const fetch = fakeFetch(() => ({ body: { full_name: 'o/r' } }));

    const { data } = await getOctokit('secret', { request: { fetch } }).rest.repos.get({ owner: 'o', repo: 'r' });

    expect(data.full_name).toBe('o/r');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('https://ghe.example.com/api/v3/repos/o/r');
    expect(headers.get('authorization')).toBe('token secret');
    expect(headers.get('user-agent')).toMatch(/^actions_orchestration_id\/run_1_2 octokit-core\.js\//);
  });

  it('sends GraphQL to the GHES GraphQL endpoint', async () => {
    vi.stubEnv('GITHUB_API_URL', 'https://ghe.example.com/api/v3');
    const fetch = fakeFetch(() => ({ body: { data: { viewer: { login: 'me' } } } }));

    await getOctokit('t', { request: { fetch } }).graphql('{ viewer { login } }');

    expect(fetch.mock.calls[0]?.[0]).toBe('https://ghe.example.com/api/graphql');
  });

  it('defaults to a proxy-aware fetch', () => {
    const { fetch } = getOctokit('t').request.endpoint.DEFAULTS.request as { fetch?: unknown };

    expect(typeof fetch).toBe('function');
    expect(fetch).not.toBe(globalThis.fetch);
  });

  it('keeps the proxy-aware fetch when request.fetch is given as undefined', () => {
    const { fetch } = getOctokit('t', { request: { fetch: undefined, retries: 1 } }).request.endpoint.DEFAULTS
      .request as { fetch?: unknown; retries?: number };

    expect(typeof fetch).toBe('function');
    expect(fetch).not.toBe(globalThis.fetch);
  });

  it('keeps the other request options alongside a given fetch', () => {
    const fetch = fakeFetch();
    const { request } = getOctokit('t', { request: { fetch, retries: 1 } }).request.endpoint.DEFAULTS;

    expect(request).toMatchObject({ fetch, retries: 1 });
  });

  it('accepts an auth option instead of a token, but not both and not neither', () => {
    expect(() => getOctokit('', { auth: 'token x' })).not.toThrow();
    expect(() => getOctokit('t', { auth: 'token x' })).toThrow(
      'Parameters token and opts.auth may not both be specified',
    );
    expect(() => getOctokit('')).toThrow('Parameter token or opts.auth is required');
  });

  it('applies additional plugins', () => {
    const octokit = getOctokit('t', undefined, () => ({ extra: 'yes' }));

    expect((octokit as unknown as { extra: string }).extra).toBe('yes');
  });
});

describe('getApiBaseUrl', () => {
  it('falls back to github.com', () => {
    expect(getApiBaseUrl({})).toBe('https://api.github.com');
    expect(getApiBaseUrl({ GITHUB_API_URL: 'https://ghe/api/v3' })).toBe('https://ghe/api/v3');
  });
});

describe('getUserAgentWithOrchestrationId', () => {
  it('leaves the user agent alone without an orchestration ID', () => {
    expect(getUserAgentWithOrchestrationId('ua', {})).toBe('ua');
    expect(getUserAgentWithOrchestrationId(undefined, { ACTIONS_ORCHESTRATION_ID: '  ' })).toBeUndefined();
  });

  it('appends the sanitised tag once', () => {
    const env = { ACTIONS_ORCHESTRATION_ID: ' a:b/c.d-e_f ' };

    expect(getUserAgentWithOrchestrationId(undefined, env)).toBe('actions_orchestration_id/a_b_c.d-e_f');
    expect(getUserAgentWithOrchestrationId('ua', env)).toBe('ua actions_orchestration_id/a_b_c.d-e_f');
    expect(getUserAgentWithOrchestrationId('ua actions_orchestration_id/a_b_c.d-e_f', env)).toBe(
      'ua actions_orchestration_id/a_b_c.d-e_f',
    );
  });
});
