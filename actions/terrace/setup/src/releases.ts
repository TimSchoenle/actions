/**
 * The published terrace-contract releases, for resolving a `MAJOR.MINOR` request.
 */
import { httpRequest, readBody } from 'actions-util';

import { ReleaseNotFoundError } from './errors.js';
import { parseReleaseTag, RELEASE_TAG_PREFIX } from './version.js';

import type { ReleaseVersion } from './version.js';

/** The repository terrace-contract is released from. */
export const RELEASE_REPOSITORY = 'TimSchoenle/terrace-config';

/** The REST API root of {@link RELEASE_REPOSITORY}. */
const REPOSITORY_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}`;

/** Refs per page, GitHub's maximum. */
const PAGE_SIZE = 100;

/**
 * Pages of tags read before giving up. One `MAJOR.MINOR` line rarely has more than a handful of
 * patches; ten pages is a thousand tags.
 */
const MAX_PAGES = 10;

/**
 * The largest response read. GitHub caps a release's notes at 125,000 characters, so a release
 * JSON-escaped with its asset entries stays well below a megabyte, and a page of refs far below that.
 * 32 MiB reads anything GitHub can serve here and bounds what a misbehaving server or proxy can make
 * the runner hold in memory.
 */
export const MAX_PAGE_BYTES = 32 * 1024 * 1024;

/** The release fields this action reads. */
interface ReleaseSummary {
  readonly draft?: unknown;
  readonly prerelease?: unknown;
}

/** A ref as `matching-refs` lists it. */
interface RefSummary {
  readonly ref?: unknown;
}

/**
 * Fetches one URL as parsed JSON, or `undefined` when the API answers 404, so the lookups can be tested
 * without a network.
 */
export type FetchJson = (url: string, token: string) => Promise<unknown>;

/**
 * The real port: the GitHub REST API through `actions-util`'s `httpRequest`, with its default socket
 * idle timeout and a body of at most {@link MAX_PAGE_BYTES}.
 *
 * Not Node's `fetch`, which ignores `HTTPS_PROXY`: a self-hosted runner behind a proxy would fail
 * here while the downloads, which go through this same client, succeed.
 */
export const fetchJson: FetchJson = async (url, token) => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token !== '') {
    headers.Authorization = `Bearer ${token}`;
  }

  const { message } = await httpRequest(url, { headers: { 'User-Agent': 'terrace-setup', ...headers } });
  const status = message.statusCode ?? 0;

  if (status < 200 || status >= 300) {
    // The error body is not reported, and the connection is never reused: close it unread.
    message.destroy();
    if (status === 404) {
      return undefined;
    }
    throw new ReleaseNotFoundError(`GET ${url} answered ${status} ${message.statusMessage ?? ''}`.trimEnd() + '.');
  }

  return JSON.parse((await readBody(message, MAX_PAGE_BYTES)).toString('utf8')) as unknown;
};

/** The terrace-contract releases whose tags start with `prefix`, read from the tags alone. */
async function taggedVersions(fetch: FetchJson, token: string, prefix: string): Promise<ReleaseVersion[]> {
  const versions: ReleaseVersion[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${REPOSITORY_API}/git/matching-refs/tags/${encodeURIComponent(prefix)}?per_page=${PAGE_SIZE}&page=${page}`;
    const body = await fetch(url, token);

    if (!Array.isArray(body)) {
      throw new ReleaseNotFoundError(`GET ${url} did not answer with a list of tags.`);
    }

    for (const entry of body as readonly RefSummary[]) {
      const version =
        typeof entry.ref === 'string' && entry.ref.startsWith('refs/tags/')
          ? parseReleaseTag(entry.ref.slice('refs/tags/'.length))
          : undefined;

      if (version !== undefined) {
        versions.push(version);
      }
    }

    if (body.length < PAGE_SIZE) {
      break;
    }
  }

  return versions;
}

/**
 * The newest published terrace-contract release of the `major.minor` line, or `undefined` when the line
 * has none.
 *
 * The line's tags are listed with one `matching-refs` request, which carries no release notes, and the
 * newest is confirmed with `GET /releases/tags/{tag}`. A tag whose release is missing, still a draft
 * (that endpoint never returns one) or a pre-release is passed over for the next patch down, so what
 * this returns is exactly what a `MAJOR.MINOR` request may resolve to.
 */
export async function latestRelease(
  fetch: FetchJson,
  token: string,
  major: number,
  minor: number,
): Promise<ReleaseVersion | undefined> {
  const prefix = `${RELEASE_TAG_PREFIX}${major}.${minor}.`;
  const candidates = (await taggedVersions(fetch, token, prefix))
    .filter((version) => version.major === major && version.minor === minor)
    .sort((a, b) => b.patch - a.patch);

  for (const candidate of candidates) {
    const tag = `${prefix}${candidate.patch}`;
    const release = (await fetch(`${REPOSITORY_API}/releases/tags/${encodeURIComponent(tag)}`, token)) as
      | ReleaseSummary
      | null
      | undefined;

    if (typeof release === 'object' && release !== null && release.draft !== true && release.prerelease !== true) {
      return candidate;
    }
  }

  return undefined;
}
