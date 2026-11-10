/**
 * The Octokit every action talks to GitHub through. Imported as `actions-util/octokit`.
 *
 * A replacement for `@actions/github`'s `getOctokit` with the same signature and the same client
 * configuration — `GITHUB_API_URL` as the base URL (so GitHub Enterprise Server works), `token`
 * authentication, the `ACTIONS_ORCHESTRATION_ID` user-agent tag, and the runner's proxy settings —
 * built from `@octokit/core` and the pagination plugin only.
 *
 * Two dependencies of `@actions/github` are left out on purpose:
 *
 *  * undici, which it bundled for proxy support alone; `http-fetch.ts` keeps proxy support without
 *    it.
 *  * `@octokit/plugin-rest-endpoint-methods`, which ships the route of every REST endpoint GitHub
 *    has (over 80 KB minified). `octokit.rest` here is generated from {@link REST_ROUTES}, the
 *    endpoints this repository calls, and typed with that plugin's own method types — so a call is
 *    checked exactly as before, and an endpoint not listed is a compile error rather than a runtime
 *    `undefined`. A unit test checks every route against the plugin's. Add an endpoint by adding its
 *    route there.
 */
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';

import { createProxyAwareFetch } from './http-fetch.js';

import type { OctokitOptions, OctokitPlugin } from '@octokit/core/types';
import type { Api } from '@octokit/plugin-rest-endpoint-methods';

/** Every REST endpoint method `@octokit/plugin-rest-endpoint-methods` types, by scope. */
type RestEndpointMethods = Api['rest'];

/** The REST endpoints `octokit.rest` exposes, as `METHOD /path` routes, by scope and method name. */
export const REST_ROUTES = {
  actions: {
    deleteActionsCacheById: 'DELETE /repos/{owner}/{repo}/actions/caches/{cache_id}',
    getActionsCacheList: 'GET /repos/{owner}/{repo}/actions/caches',
    listJobsForWorkflowRun: 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
    listWorkflowRunArtifacts: 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts',
  },
  checks: {
    create: 'POST /repos/{owner}/{repo}/check-runs',
    listForRef: 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
  },
  git: {
    createRef: 'POST /repos/{owner}/{repo}/git/refs',
    deleteRef: 'DELETE /repos/{owner}/{repo}/git/refs/{ref}',
    getCommit: 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
    getRef: 'GET /repos/{owner}/{repo}/git/ref/{ref}',
    updateRef: 'PATCH /repos/{owner}/{repo}/git/refs/{ref}',
  },
  issues: {
    addLabels: 'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
    create: 'POST /repos/{owner}/{repo}/issues',
    createComment: 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
    createLabel: 'POST /repos/{owner}/{repo}/labels',
    deleteComment: 'DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}',
    deleteLabel: 'DELETE /repos/{owner}/{repo}/labels/{name}',
    get: 'GET /repos/{owner}/{repo}/issues/{issue_number}',
    listComments: 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
    listForRepo: 'GET /repos/{owner}/{repo}/issues',
    update: 'PATCH /repos/{owner}/{repo}/issues/{issue_number}',
    updateComment: 'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}',
  },
  pulls: {
    create: 'POST /repos/{owner}/{repo}/pulls',
    createReview: 'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
    get: 'GET /repos/{owner}/{repo}/pulls/{pull_number}',
    list: 'GET /repos/{owner}/{repo}/pulls',
    listReviews: 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
    merge: 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
    update: 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
    updateBranch: 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch',
  },
  repos: {
    compareCommitsWithBasehead: 'GET /repos/{owner}/{repo}/compare/{basehead}',
    createOrUpdateFileContents: 'PUT /repos/{owner}/{repo}/contents/{path}',
    get: 'GET /repos/{owner}/{repo}',
    getCommit: 'GET /repos/{owner}/{repo}/commits/{ref}',
    getContent: 'GET /repos/{owner}/{repo}/contents/{path}',
  },
  users: {
    getAuthenticated: 'GET /user',
    getByUsername: 'GET /users/{username}',
  },
} as const satisfies {
  readonly [Scope in keyof RestEndpointMethods]?: { readonly [Method in keyof RestEndpointMethods[Scope]]?: string };
};

type RestRoutes = typeof REST_ROUTES;

/** `octokit.rest`: the listed endpoints, typed exactly as `@octokit/plugin-rest-endpoint-methods` types them. */
export type RestEndpoints = {
  readonly [Scope in keyof RestRoutes]: Pick<
    RestEndpointMethods[Scope],
    keyof RestRoutes[Scope] & keyof RestEndpointMethods[Scope]
  >;
};

/**
 * The plugin adding `octokit.rest`. Each method is `octokit.request` with the route's method and URL
 * as defaults — what the full plugin builds for these endpoints, none of which carries extra
 * defaults or decorations — so it also carries the `endpoint` the pagination plugin reads.
 */
export function restEndpoints(octokit: Octokit): { rest: RestEndpoints } {
  const rest: Record<string, Record<string, unknown>> = {};

  for (const [scope, methods] of Object.entries(REST_ROUTES)) {
    const scoped: Record<string, unknown> = {};

    for (const [name, route] of Object.entries(methods)) {
      const [method, url] = route.split(' ');
      scoped[name] = octokit.request.defaults({ method, url });
    }

    rest[scope] = scoped;
  }

  return { rest: rest as unknown as RestEndpoints };
}

/**
 * The Octokit class with `octokit.rest` and pagination. Not exported: unlike `@actions/github`'s
 * `GitHub`, it carries none of the defaults {@link getOctokit} applies.
 */
const GitHub = Octokit.plugin(restEndpoints, paginateRest);

/** An Octokit client as {@link getOctokit} returns it. */
export type GitHubClient = InstanceType<typeof GitHub>;

/** The REST API base URL: `GITHUB_API_URL` (set on GitHub Enterprise Server too), else github.com's. */
export function getApiBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.GITHUB_API_URL || 'https://api.github.com';
}

/**
 * Appends the runner's `ACTIONS_ORCHESTRATION_ID` to a user agent, as `@actions/github` does, so
 * GitHub can attribute API calls to the job that made them.
 */
export function getUserAgentWithOrchestrationId(
  baseUserAgent: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const orchestrationId = env.ACTIONS_ORCHESTRATION_ID?.trim();

  if (!orchestrationId) {
    return baseUserAgent;
  }

  const tag = `actions_orchestration_id/${orchestrationId.replaceAll(/[^\w.-]/g, '_')}`;
  if (baseUserAgent?.includes(tag)) {
    return baseUserAgent;
  }

  return `${baseUserAgent ? `${baseUserAgent} ` : ''}${tag}`;
}

/**
 * Creates an authenticated client, as `@actions/github`'s `getOctokit` does: `token` (or an `auth`
 * option, never both), the `GITHUB_API_URL` base URL, and the runner's proxy settings. `options`
 * override those defaults, except that `request.fetch` replaces the proxy-aware fetch only when it is
 * a function; `additionalPlugins` are applied on top.
 */
export function getOctokit(
  token: string,
  options?: OctokitOptions,
  ...additionalPlugins: OctokitPlugin[]
): GitHubClient {
  const opts: OctokitOptions = { ...options };

  if (!token && !opts.auth) {
    throw new Error('Parameter token or opts.auth is required');
  }

  if (token && opts.auth) {
    throw new Error('Parameters token and opts.auth may not both be specified');
  }

  opts.auth = typeof opts.auth === 'string' ? opts.auth : `token ${token}`;

  const userAgent = getUserAgentWithOrchestrationId(opts.userAgent);
  if (userAgent) {
    opts.userAgent = userAgent;
  }

  const Client = GitHub.plugin(...additionalPlugins);
  // Only a fetch actually given replaces the proxy-aware one; an explicit `fetch: undefined` does not.
  const fetch: unknown = opts.request?.fetch;

  return new Client({
    baseUrl: getApiBaseUrl(),
    ...opts,
    request: { ...opts.request, fetch: typeof fetch === 'function' ? fetch : createProxyAwareFetch() },
  });
}
