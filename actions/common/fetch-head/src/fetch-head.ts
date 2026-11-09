import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { parseRepository, quoteForLog } from 'actions-util';
import { runGitText } from 'actions-util/patch';

/** A full commit SHA. An abbreviated one or a ref name could resolve to something else. */
const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Schemes a server URL may use: GitHub's, and `file` for a local server. */
const SERVER_SCHEMES = new Set(['https:', 'http:', 'file:']);

/** Raised for an input that is refused before anything is fetched. */
export class FetchHeadInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchHeadInputError';
  }
}

/** What to fetch, and where. */
export interface FetchHeadRequest {
  /** The commit to fetch. */
  sha: string;
  /** Repository to fetch from, as `owner/repo`. */
  repository: string;
  /** Token sent with the fetch. Empty fetches anonymously. */
  token: string;
  /** URL of the server the repository lives on. */
  serverUrl: string;
  /** Absolute directory to create the repository in, already confined to the workspace. */
  directory: string;
}

/** Schemes git sends an HTTP header over. Any other transport gets no token. */
const HTTP_SCHEMES = new Set(['https:', 'http:']);

/** Hosts plain `http:` may carry a token to: the machine itself, as a local test server is. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Runs `git` in a directory with extra environment, and resolves to its trimmed output. */
export type GitRunner = (
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
) => Promise<string>;

/** The runner the action uses: `git` without a shell and with prompts disabled. */
export const runGit: GitRunner = (args, cwd, env) => runGitText(args, { cwd, env });

/**
 * The token as HTTP basic credentials, `x-access-token:<token>` in base64, as actions/checkout sends it.
 *
 * Exposed so the action can mask it. The runner masks the token itself but not this encoding of it,
 * and masking only matches exact strings, so the encoding is masked on its own as well as inside the
 * header.
 */
export function basicCredentials(token: string): string {
  return Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
}

/** The header line git is configured to send. */
export function authorizationHeader(token: string): string {
  return `AUTHORIZATION: basic ${basicCredentials(token)}`;
}

/**
 * Environment that pins every git command to the repository in `directory`.
 *
 * An earlier step can export `GIT_DIR` and its relatives through `GITHUB_ENV`, and git would follow
 * them to another repository while `path` stayed empty. Each is set here explicitly instead.
 */
export function repositoryEnvironment(directory: string): Record<string, string> {
  const gitDirectory = path.join(directory, '.git');

  return {
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
    GIT_COMMON_DIR: gitDirectory,
    GIT_DIR: gitDirectory,
    GIT_INDEX_FILE: path.join(gitDirectory, 'index'),
    GIT_OBJECT_DIRECTORY: path.join(gitDirectory, 'objects'),
    GIT_WORK_TREE: directory,
  };
}

/**
 * Environment that makes git send the token to `serverUrl`, and only there.
 *
 * `GIT_CONFIG_COUNT` configuration lives in the environment of the one command it is given to: unlike
 * `git -c`, it is not visible in the process list, and unlike `git config`, nothing is written to the
 * repository, so no later step can read the token back. Empty for an anonymous fetch, and for a
 * `file:` server, which no header reaches.
 */
export function authEnvironment(serverUrl: string, token: string): Record<string, string> {
  const url = new URL(serverUrl);
  if (token === '' || !HTTP_SCHEMES.has(url.protocol)) {
    return {};
  }

  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${url.origin}/.extraheader`,
    GIT_CONFIG_VALUE_0: authorizationHeader(token),
  };
}

/** The URL git fetches from: the repository's clone URL on `serverUrl`. */
export function repositoryUrl(serverUrl: string, repository: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/${repository}.git`;
}

/**
 * Checks every input before anything touches the disk or the network.
 *
 * @throws {FetchHeadInputError} on an abbreviated or malformed SHA, a repository that is not
 * `owner/repo`, a server URL that is not an http(s) or file URL, or a token bound for a plain `http:`
 * server other than this machine.
 */
export function validateRequest(request: FetchHeadRequest): void {
  if (!SHA_PATTERN.test(request.sha)) {
    throw new FetchHeadInputError(`sha must be a full 40-character commit SHA, got ${quoteForLog(request.sha)}`);
  }

  try {
    parseRepository(request.repository);
  } catch {
    throw new FetchHeadInputError(`repository must be owner/repo, got ${quoteForLog(request.repository)}`);
  }

  let url: URL;
  try {
    url = new URL(request.serverUrl);
  } catch {
    throw new FetchHeadInputError(`server_url must be a URL, got ${quoteForLog(request.serverUrl)}`);
  }
  if (!SERVER_SCHEMES.has(url.protocol)) {
    throw new FetchHeadInputError(
      `server_url must be an https, http or file URL, got ${quoteForLog(request.serverUrl)}`,
    );
  }
  if (url.protocol === 'http:' && request.token !== '' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new FetchHeadInputError(
      `server_url must be https to send a token, got ${quoteForLog(request.serverUrl)}; set token to '' to fetch anonymously`,
    );
  }
}

/**
 * Creates `directory` if it is missing, and refuses one that holds anything: initialising a
 * repository over existing files would leave them beside a HEAD they do not belong to.
 *
 * @throws {FetchHeadInputError} when the directory is not empty.
 */
export async function prepareDirectory(directory: string, inputName: string): Promise<void> {
  await mkdir(directory, { recursive: true });

  const entries = await readdir(directory);
  if (entries.length > 0) {
    throw new FetchHeadInputError(
      `${inputName} must be empty or not exist yet, but holds ${String(entries.length)} entr${entries.length === 1 ? 'y' : 'ies'}`,
    );
  }
}

/**
 * Fetches `sha` into a new repository in `directory` and points a detached HEAD at it, without
 * checking anything out: the directory ends up holding `.git` and nothing else, so no file of the
 * commit can be run or read as a file by a later step.
 *
 * When git fails, the repository this call created is removed again, so the directory is left as
 * empty as it was found and the step can be re-run.
 *
 * @returns the commit HEAD points at.
 * @throws {FetchHeadInputError} on a refused input or a non-empty directory.
 * @throws {Error} when git fails, or when HEAD does not resolve to `sha` afterwards.
 */
export async function fetchHead(request: FetchHeadRequest, git: GitRunner = runGit): Promise<string> {
  validateRequest(request);
  await prepareDirectory(request.directory, 'path');

  const { directory, repository, serverUrl, sha, token } = request;
  const pinned = repositoryEnvironment(directory);
  try {
    await git(['init', '--quiet'], directory, pinned);
    await git(
      [
        'fetch',
        '--quiet',
        '--depth=1',
        '--no-tags',
        '--no-recurse-submodules',
        repositoryUrl(serverUrl, repository),
        sha,
      ],
      directory,
      { ...pinned, ...authEnvironment(serverUrl, token) },
    );
    await git(['update-ref', '--no-deref', 'HEAD', sha], directory, pinned);

    const head = await git(['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], directory, pinned);
    if (head !== sha) {
      throw new Error(`HEAD resolves to ${quoteForLog(head)} after the fetch, not to ${sha}.`);
    }

    return head;
  } catch (error) {
    await rm(path.join(directory, '.git'), { force: true, recursive: true });
    throw error;
  }
}
