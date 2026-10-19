/**
 * The published terrace-contract releases, for resolving a `MAJOR.MINOR` request.
 */
import { HttpClient } from '@actions/http-client';

import { ReleaseNotFoundError } from './errors.js';
import { parseReleaseTag } from './version.js';

import type { ReleaseVersion } from './version.js';

/** The repository terrace-contract is released from. */
export const RELEASE_REPOSITORY = 'TimSchoenle/terrace-config';

/** Releases per page, GitHub's maximum. */
const PAGE_SIZE = 100;

/**
 * Pages read before giving up. terrace-config releases four components from one repository, so a
 * `MAJOR.MINOR` line can sit several pages back; ten pages is a thousand releases.
 */
const MAX_PAGES = 10;

/** The release fields this action reads. */
interface ReleaseSummary {
  readonly tag_name?: unknown;
  readonly draft?: unknown;
  readonly prerelease?: unknown;
}

/** Fetches one URL as parsed JSON, so the listing can be tested without a network. */
export type FetchJson = (url: string, token: string) => Promise<unknown>;

/**
 * The real port: the GitHub REST API through `@actions/http-client`.
 *
 * Not Node's `fetch`, which ignores `HTTPS_PROXY`: a self-hosted runner behind a proxy would fail
 * here while the downloads, which `@actions/tool-cache` makes through this same client, succeed.
 */
export const fetchJson: FetchJson = async (url, token) => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token !== '') {
    headers.Authorization = `Bearer ${token}`;
  }

  const client = new HttpClient('terrace-setup');

  try {
    const response = await client.get(url, headers);
    const status = response.message.statusCode ?? 0;
    const body = await response.readBody();

    if (status < 200 || status >= 300) {
      throw new ReleaseNotFoundError(
        `GET ${url} answered ${status} ${response.message.statusMessage ?? ''}`.trimEnd() + '.',
      );
    }

    return JSON.parse(body) as unknown;
  } finally {
    client.dispose();
  }
};

/**
 * Every published terrace-contract release, newest page first.
 *
 * Drafts and pre-releases are left out, as are the other components' releases this repository also
 * publishes, so what remains is exactly what a `MAJOR.MINOR` request may resolve to.
 */
export async function listReleases(fetch: FetchJson, token: string): Promise<ReleaseVersion[]> {
  const releases: ReleaseVersion[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=${PAGE_SIZE}&page=${page}`;
    const body = await fetch(url, token);

    if (!Array.isArray(body)) {
      throw new ReleaseNotFoundError(`GET ${url} did not answer with a list of releases.`);
    }

    for (const entry of body as readonly ReleaseSummary[]) {
      if (entry.draft === true || entry.prerelease === true || typeof entry.tag_name !== 'string') {
        continue;
      }

      const version = parseReleaseTag(entry.tag_name);

      if (version !== undefined) {
        releases.push(version);
      }
    }

    if (body.length < PAGE_SIZE) {
      break;
    }
  }

  return releases;
}
