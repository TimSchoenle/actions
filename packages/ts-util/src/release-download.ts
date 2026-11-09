/**
 * Downloading a GitHub release asset, with the REST API asset endpoint as a fallback.
 *
 * The release download URL (`github.com/<repo>/releases/download/<tag>/<name>`) has answered 5xx for
 * one repository while the REST API's asset endpoint served the same file. So a download that still
 * fails after its retries with a 5xx, a timeout or a connection error is fetched again through the
 * API. Both routes serve the same bytes, and the caller verifies them the same way afterwards, so
 * the fallback changes where a file comes from, never what is accepted.
 *
 * The token is sent only to `api.github.com`, and only when the job runs on github.com: a GitHub
 * Enterprise Server token is not a github.com credential. The asset URL is built from the numeric
 * asset ID, never taken from the release JSON, so the response cannot steer the token to another
 * host. `@actions/http-client` drops the `Authorization` header when the asset endpoint redirects
 * to the storage host.
 */
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { Transform, Writable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import * as core from '@actions/core';
import { HttpClient } from '@actions/http-client';

import { errorMessage } from './errors.js';

import type { WriteStream } from 'node:fs';

export * from './checksums.js';

/** The host the token may be sent to. */
const API_ORIGIN = 'https://api.github.com';

/** The server URL of a job running on github.com, as the runner sets `GITHUB_SERVER_URL`. */
const GITHUB_COM = 'https://github.com';

/** Attempts per request before it counts as failed. */
const ATTEMPTS = 3;

/** The pause before the second and the third attempt. */
const RETRY_DELAYS_MS: readonly number[] = [5000, 10_000];

/** An owner, a slash and a repository name, in the characters GitHub allows in each. */
const REPOSITORY = /^[\dA-Za-z][\dA-Za-z-]*\/[\w.-]+$/;

/** Whitespace and control characters, which no tag or asset name this module requests contains. */
const UNSAFE = /[\s\p{Cc}]/u;

/** A release asset: the repository as `owner/repo`, the release's tag and the asset's file name. */
export interface ReleaseAssetRef {
  readonly repository: string;
  readonly tag: string;
  readonly name: string;
}

/** A field of a {@link ReleaseAssetRef} that cannot be spliced into a URL. */
export class InvalidReleaseAssetError extends Error {
  constructor(
    readonly field: keyof ReleaseAssetRef,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
    this.name = 'InvalidReleaseAssetError';
  }
}

/** A download or release lookup failed. */
export class ReleaseDownloadError extends Error {
  /** The HTTP status the server answered with, when it answered at all. */
  readonly httpStatusCode: number | undefined;
  /** Whether trying again, or through the other route, may succeed. */
  readonly retryable: boolean;

  constructor(message: string, options: { httpStatusCode?: number; retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'ReleaseDownloadError';
    this.httpStatusCode = options.httpStatusCode;
    this.retryable = options.retryable;
  }
}

/** Whether a response with `status` may succeed on another attempt: a 5xx, a 408 or a 429. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/** The network, injected so the download logic can be tested offline. */
export interface HttpTransport {
  /**
   * Streams the body of a `GET` to `destination`, following redirects. Rejects with a
   * {@link ReleaseDownloadError} on any status but 200, a timeout or a connection error.
   */
  download(url: string, headers: Readonly<Record<string, string>>, destination: string): Promise<void>;
  /** The parsed JSON body of a `GET`. Rejects as {@link HttpTransport.download} does. */
  getJson(url: string, headers: Readonly<Record<string, string>>): Promise<unknown>;
}

/** Everything a {@link ReleaseDownloader} needs from outside. */
export interface ReleaseDownloadPorts extends HttpTransport {
  sleep(milliseconds: number): Promise<void>;
  info(message: string): void;
  warning(message: string): void;
}

/** The credentials a {@link ReleaseDownloader} may use, and where the job runs. */
export interface ReleaseDownloadOptions {
  /** Token for the REST API fallback. Empty sends none. */
  readonly token: string;
  /** `GITHUB_SERVER_URL` of the job. The token is sent only when it is `https://github.com`. */
  readonly serverUrl: string;
}

/** Throws unless every field of `asset` can be spliced into a GitHub URL as one path segment. */
export function assertReleaseAssetRef(asset: ReleaseAssetRef): void {
  if (!REPOSITORY.test(asset.repository) || /\/\.{1,2}$/.test(asset.repository)) {
    throw new InvalidReleaseAssetError('repository', `must be owner/repo, got ${JSON.stringify(asset.repository)}.`);
  }

  if (
    asset.tag === '' ||
    UNSAFE.test(asset.tag) ||
    asset.tag.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new InvalidReleaseAssetError(
      'tag',
      `must be a tag name without whitespace or . and .. segments, got ${JSON.stringify(asset.tag)}.`,
    );
  }

  if (
    asset.name === '' ||
    asset.name === '.' ||
    asset.name === '..' ||
    UNSAFE.test(asset.name) ||
    // The name is also the local file name, so it must be one every runner can create: no path
    // separators, and none of the characters Windows refuses (a colon would open a data stream).
    /[/\\:*?"<>|]/.test(asset.name)
  ) {
    throw new InvalidReleaseAssetError(
      'name',
      `must be a file name without whitespace, path separators or :*?"<>|, got ${JSON.stringify(asset.name)}.`,
    );
  }
}

/** The release download URL of `asset` on github.com. */
export function releaseDownloadUrl(asset: ReleaseAssetRef): string {
  const tag = asset.tag.split('/').map(encodeURIComponent).join('/');

  return `${GITHUB_COM}/${asset.repository}/releases/download/${tag}/${encodeURIComponent(asset.name)}`;
}

/** The REST API URL describing the release tagged `tag`. */
function releaseApiUrl(repository: string, tag: string): string {
  return `${API_ORIGIN}/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`;
}

/** The REST API URL serving asset `id`. Built from the ID alone, so the release JSON cannot pick the host. */
function assetApiUrl(repository: string, id: number): string {
  return `${API_ORIGIN}/repos/${repository}/releases/assets/${id}`;
}

/** The headers of every REST API request, with the token only when it was issued by github.com. */
export function apiHeaders(options: ReleaseDownloadOptions, accept: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };

  if (options.token !== '' && options.serverUrl === GITHUB_COM) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  return headers;
}

/**
 * The ID of the one asset of `release` named `name`.
 *
 * Zero matches and several are both refused: the name is the whole identity of what the caller asked
 * for, and guessing between two files of the same name would download one the caller did not pin.
 */
export function selectAssetId(release: unknown, asset: ReleaseAssetRef): number {
  const where = `release ${asset.tag} of ${asset.repository}`;
  const assets = typeof release === 'object' && release !== null ? (release as { assets?: unknown }).assets : undefined;

  if (!Array.isArray(assets)) {
    throw new ReleaseDownloadError(`The REST API answer for ${where} lists no assets.`, { retryable: false });
  }

  const matches = assets.filter(
    (entry): entry is { id?: unknown } =>
      typeof entry === 'object' && entry !== null && (entry as { name?: unknown }).name === asset.name,
  );

  if (matches.length !== 1) {
    throw new ReleaseDownloadError(`${where} has ${matches.length} assets named ${asset.name}, expected exactly one.`, {
      retryable: false,
    });
  }

  const id = matches[0]?.id;

  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new ReleaseDownloadError(
      `${where} gives asset ${asset.name} the ID ${JSON.stringify(id)}, not a positive integer.`,
      {
        retryable: false,
      },
    );
  }

  return id;
}

function isRetryable(error: unknown): boolean {
  return error instanceof ReleaseDownloadError && error.retryable;
}

/**
 * Downloads release assets, remembering each release it looked up through the REST API so that
 * several assets of one release cost one lookup.
 */
export class ReleaseDownloader {
  private readonly releases = new Map<string, Promise<unknown>>();

  constructor(
    private readonly ports: ReleaseDownloadPorts,
    private readonly options: ReleaseDownloadOptions,
  ) {}

  /**
   * Downloads `asset` to `destination`, through the REST API when the release download fails with a
   * retryable error after its retries. Any other failure, a 404 included, is passed through: the
   * asset is missing, and asking the API would only say so again.
   */
  async download(asset: ReleaseAssetRef, destination: string): Promise<void> {
    assertReleaseAssetRef(asset);

    const direct = releaseDownloadUrl(asset);

    try {
      await this.withRetries(direct, () => this.ports.download(direct, {}, destination));

      return;
    } catch (error) {
      if (!isRetryable(error)) {
        throw error;
      }

      this.ports.warning(
        `Downloading ${asset.name} from ${direct} failed: ${errorMessage(error)} Retrying through the GitHub REST API.`,
      );
    }

    const id = selectAssetId(await this.release(asset), asset);
    const url = assetApiUrl(asset.repository, id);

    await this.withRetries(url, () =>
      this.ports.download(url, apiHeaders(this.options, 'application/octet-stream'), destination),
    );
  }

  /** The release JSON for `asset`'s tag, looked up at most once while lookups succeed. */
  private release(asset: ReleaseAssetRef): Promise<unknown> {
    const key = `${asset.repository}@${asset.tag}`;
    const cached = this.releases.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const url = releaseApiUrl(asset.repository, asset.tag);
    const lookup = this.withRetries(url, () =>
      this.ports.getJson(url, apiHeaders(this.options, 'application/vnd.github+json')),
    );

    this.releases.set(key, lookup);
    // A failed lookup is forgotten, so the next asset of the release tries again.
    lookup.catch(() => this.releases.delete(key));

    return lookup;
  }

  /** Runs `request` until it succeeds, fails without being retryable, or runs out of attempts. */
  private async withRetries<T>(url: string, request: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request();
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt - 1];

        if (!isRetryable(error) || attempt >= ATTEMPTS || delay === undefined) {
          throw error;
        }

        this.ports.info(
          `GET ${url} failed (${errorMessage(error)}); attempt ${attempt + 1} of ${ATTEMPTS} in ${delay / 1000}s.`,
        );
        await this.ports.sleep(delay);
      }
    }
  }
}

/** How long a connection may go without receiving a byte before it counts as stalled. */
export interface TransportTimeouts {
  readonly idleMs: number;
}

const DEFAULT_TIMEOUTS: TransportTimeouts = { idleMs: 30_000 };

/** The destination could not be written: a full disk or a bad path, which retrying cannot fix. */
class LocalFileError extends Error {
  constructor(destination: string, cause: unknown) {
    super(`Cannot write ${destination}: ${errorMessage(cause)}`, { cause });
    this.name = 'LocalFileError';
  }
}

function failure(url: string, status: number, statusMessage: string | undefined): ReleaseDownloadError {
  return new ReleaseDownloadError(`GET ${url} answered ${status} ${statusMessage ?? ''}`.trimEnd() + '.', {
    httpStatusCode: status,
    retryable: isRetryableStatus(status),
  });
}

function asDownloadError(url: string, error: unknown): ReleaseDownloadError {
  if (error instanceof ReleaseDownloadError) {
    return error;
  }

  if (error instanceof LocalFileError) {
    return new ReleaseDownloadError(error.message, { retryable: false, cause: error });
  }

  // No HTTP status: the connection failed, stalled or was cut, all of which may not happen again.
  return new ReleaseDownloadError(`GET ${url} failed: ${errorMessage(error)}`, { retryable: true, cause: error });
}

/**
 * A pass-through that fails once no chunk has arrived for `idleMs`, so a server that stops sending
 * mid-body cannot hold the job until its timeout. Idle rather than total, so a large asset on a slow
 * link still finishes. The client's own socket timeout does not cover this: once the response has
 * arrived it only half-closes the socket, which a stalled server may never answer.
 */
function idleGuard(idleMs: number): Transform {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      arm();
      done(null, chunk);
    },
    flush(done) {
      clearTimeout(timer);
      done();
    },
    destroy(error, done) {
      clearTimeout(timer);
      done(error);
    },
  });
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => guard.destroy(new Error(`no data arrived for ${idleMs / 1000}s`)), idleMs);
    // The stream it guards keeps the process alive while it is open; the timer alone must not.
    timer.unref();
  };

  arm();

  return guard;
}

/**
 * A sink writing to `destination` whose own failures, and only those, are {@link LocalFileError}s.
 *
 * `pipeline` destroys every stream with the first error, so the file stream also reports a network
 * failure; telling the two apart by which stream emitted an error would class a cut connection as a
 * full disk. Wrapping each write tags the errors the file itself raised.
 */
async function openDestination(destination: string): Promise<Writable> {
  const file: WriteStream = createWriteStream(destination);
  const local = (error: unknown): LocalFileError => new LocalFileError(destination, error);

  try {
    await once(file, 'open');
  } catch (error) {
    throw local(error);
  }

  // Every write error also arrives through the write or finish callbacks below, which report it.
  file.on('error', () => undefined);

  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      file.write(chunk, (error) => done(error ? local(error) : undefined));
    },
    final(done) {
      file.end();
      finished(file).then(
        () => done(),
        (error: unknown) => done(local(error)),
      );
    },
    destroy(error, done) {
      file.destroy();
      done(error);
    },
  });
}

/**
 * The real network: `@actions/http-client`, not Node's `fetch`, because `fetch` ignores `HTTPS_PROXY`
 * and a self-hosted runner behind a proxy would fail here while every other download succeeds.
 *
 * The client's own retries are off; {@link ReleaseDownloader} retries, so it can fall back after.
 */
export function createHttpTransport(userAgent: string, timeouts: TransportTimeouts = DEFAULT_TIMEOUTS): HttpTransport {
  // The socket timeout covers connecting and waiting for headers; the idle guard covers the body.
  // It is a backstop at twice the idle limit, so a stalled body is reported by the guard.
  const client = (): HttpClient =>
    new HttpClient(userAgent, [], { allowRetries: false, socketTimeout: timeouts.idleMs * 2 });

  return {
    async download(url, headers, destination) {
      const http = client();

      try {
        const response = await http.get(url, { ...headers });
        const status = response.message.statusCode ?? 0;

        if (status !== 200) {
          // The body of a failed response is not needed; draining it frees the connection.
          response.message.resume();
          throw failure(url, status, response.message.statusMessage);
        }

        let sink: Writable;

        try {
          sink = await openDestination(destination);
        } catch (error) {
          response.message.resume();
          throw error;
        }

        // The guard's timer starts when it is created, so it is created only once the pipeline that
        // owns it is certain to run.
        await pipeline(response.message, idleGuard(timeouts.idleMs), sink);

        // A cut connection can end the stream without an error; only a complete body is a download.
        if (!response.message.complete) {
          throw new ReleaseDownloadError(`GET ${url} ended before the whole body arrived.`, { retryable: true });
        }
      } catch (error) {
        throw asDownloadError(url, error);
      } finally {
        http.dispose();
      }
    },

    async getJson(url, headers) {
      const http = client();
      const chunks: Buffer[] = [];

      try {
        const response = await http.get(url, { ...headers });
        const status = response.message.statusCode ?? 0;

        await pipeline(
          response.message,
          idleGuard(timeouts.idleMs),
          new Writable({
            write(chunk: Buffer, _encoding, done) {
              chunks.push(chunk);
              done();
            },
          }),
        );

        if (status < 200 || status >= 300) {
          throw failure(url, status, response.message.statusMessage);
        }
      } catch (error) {
        throw asDownloadError(url, error);
      } finally {
        http.dispose();
      }

      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch (error) {
        throw new ReleaseDownloadError(`GET ${url} did not answer with JSON.`, { retryable: false, cause: error });
      }
    },
  };
}

/** The real ports: {@link createHttpTransport}, a timer and the step log. */
export function createReleaseDownloadPorts(userAgent: string): ReleaseDownloadPorts {
  return {
    ...createHttpTransport(userAgent),
    sleep: (milliseconds) => sleep(milliseconds),
    info: (message) => core.info(message),
    warning: (message) => core.warning(message),
  };
}
