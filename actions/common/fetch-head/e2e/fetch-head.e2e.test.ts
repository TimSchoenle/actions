import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runAction, Workspace } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authorizationHeader, basicCredentials } from '../src/fetch-head.js';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';
import type { AddressInfo } from 'node:net';

/**
 * End-to-end cases for `actions/common/fetch-head`: the shipped bundle, run the way the runner runs it.
 *
 * The server is a local mirror reached over `file://`, so every case runs offline. Its tip, an older
 * commit, and a commit reachable only from `refs/pull/1/head` — which is how a base repository serves
 * the head of a fork's pull request — cover what a workflow fetches. The token cases serve the same
 * mirror over HTTP through `git http-backend`, behind a server that refuses any request without the
 * expected header, as GitHub refuses a private repository. The fetch from github.com with the job
 * token is the extra job in `extra-jobs.yaml`.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

/** Whether this machine lets the test create the symbolic link the confinement case needs. */
const SYMLINKS_SUPPORTED = await Workspace.symlinksSupported();

/** A smart-HTTP git server that records the authorization header of every request it receives. */
interface GitHttpServer {
  url: string;
  authorizations: (string | undefined)[];
  close: () => Promise<void>;
}

/** Splits CGI output into its status, headers and body. */
function parseCgiResponse(output: Buffer): { status: number; headers: [string, string][]; body: Buffer } {
  const separator = output.indexOf('\r\n\r\n');
  if (separator === -1) {
    throw new Error(`git http-backend wrote no header block: ${output.toString('utf8')}`);
  }

  let status = 200;
  const headers: [string, string][] = [];
  for (const line of output.subarray(0, separator).toString('utf8').split('\r\n')) {
    const colon = line.indexOf(':');
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name.toLowerCase() === 'status') {
      status = Number.parseInt(value, 10);
    } else {
      headers.push([name, value]);
    }
  }

  return { body: output.subarray(separator + 4), headers, status };
}

/** A request header as one string, empty when it is absent. */
function header(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(', ') : (value ?? '');
}

/**
 * Serves every repository under `projectRoot` through `git http-backend`, answering 401 to any
 * request whose authorization header is not `expected`.
 */
async function startGitHttpServer(projectRoot: string, expected: string): Promise<GitHttpServer> {
  const authorizations: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    authorizations.push(request.headers.authorization);
    if (request.headers.authorization !== expected) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fetch-head-e2e"' }).end();
      return;
    }

    const url = new URL(request.url ?? '/', 'http://localhost');
    const systemRoot = process.env['SystemRoot'];
    const backend = spawn('git', ['http-backend'], {
      env: {
        CONTENT_TYPE: header(request.headers['content-type']),
        GIT_HTTP_EXPORT_ALL: '1',
        GIT_PROJECT_ROOT: projectRoot,
        GIT_PROTOCOL: header(request.headers['git-protocol']),
        HTTP_CONTENT_ENCODING: header(request.headers['content-encoding']),
        PATH: process.env['PATH'] ?? '',
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.replace(/^\?/, ''),
        REMOTE_ADDR: '127.0.0.1',
        REQUEST_METHOD: request.method ?? 'GET',
        ...(systemRoot === undefined ? {} : { SystemRoot: systemRoot }),
      },
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    backend.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    backend.on('error', (error) => response.writeHead(500).end(error.message));
    backend.on('close', () => {
      const { body, headers, status } = parseCgiResponse(Buffer.concat(chunks));
      response.writeHead(status, headers.flat()).end(body);
    });
    request.pipe(backend.stdin);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    authorizations,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: `http://127.0.0.1:${String(port)}`,
  };
}

describe('fetch-head', () => {
  let root: string;
  let source: Workspace;
  let target: Workspace;
  let serverUrl: string;
  let older: string;
  let tip: string;
  let pullHead: string;

  /** Commits `files` in the source repository and resolves to the new commit. */
  async function commit(files: Record<string, string>, message: string): Promise<string> {
    await source.write(files);
    await source.git(['add', '--all']);
    await source.git(['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', 'commit', '--quiet', '-m', message]);

    return (await source.git(['rev-parse', 'HEAD'])).trim();
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fetch-head-e2e-'));
    source = await Workspace.create();
    await source.initGit();
    older = await commit({ 'README.md': '# Old\n' }, 'older');
    tip = await commit({ 'README.md': '# Tip\n', 'run.sh': 'echo ran > ran.txt\n' }, 'tip');
    pullHead = await commit({ 'README.md': '# Pull\n' }, 'pull request head');
    await source.git(['update-ref', 'refs/pull/1/head', pullHead]);
    await source.git(['reset', '--quiet', '--hard', tip]);

    const server = path.join(root, 'server');
    await mkdir(path.join(server, 'owner'), { recursive: true });
    const mirror = path.join(server, 'owner', 'repo.git');
    await source.git(['clone', '--quiet', '--mirror', source.path, mirror]);
    // GitHub serves any commit it holds by SHA; a plain repository serves only advertised tips.
    await source.git(['-C', mirror, 'config', 'uploadpack.allowAnySHA1InWant', 'true']);
    serverUrl = pathToFileURL(server).href;

    target = await Workspace.create();
  });

  afterEach(async () => {
    await target.dispose();
    await source.dispose();
    await rm(root, { force: true, recursive: true });
  });

  /** Runs the action into `target` against the local server, with `inputs` over the defaults. */
  function fetch(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
    env: Readonly<Record<string, string>> = {},
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      env,
      expect: expected,
      inputs: { path: '.', repository: 'owner/repo', server_url: serverUrl, token: '', ...inputs },
      workspace: target,
    });
  }

  /** Every file in the target outside `.git`. */
  async function checkedOutFiles(): Promise<string[]> {
    return (await target.entries()).filter((entry) => !entry.startsWith('.git/'));
  }

  it('fetches the tip and points HEAD at it without writing a file', async () => {
    const result = await fetch({ sha: tip });

    expect(result.outputs.sha).toBe(tip);
    expect((await target.git(['rev-parse', 'HEAD'])).trim()).toBe(tip);
    expect((await target.git(['cat-file', '-p', `${tip}:run.sh`])).trim()).toBe('echo ran > ran.txt');
    expect(await checkedOutFiles()).toEqual([]);
  });

  it('fetches a commit that is not a branch tip', async () => {
    const result = await fetch({ sha: older });

    expect(result.outputs.sha).toBe(older);
    expect((await target.git(['show', `${older}:README.md`])).trim()).toBe('# Old');
  });

  it("fetches a commit reachable only from a pull request ref, as a fork's head is", async () => {
    const result = await fetch({ sha: pullHead });

    expect(result.outputs.sha).toBe(pullHead);
    expect(await checkedOutFiles()).toEqual([]);
  });

  it('leaves HEAD detached', async () => {
    await fetch({ sha: tip });

    await expect(target.git(['symbolic-ref', '--quiet', 'HEAD'])).rejects.toThrow();
  });

  it('creates the repository in a subdirectory', async () => {
    await fetch({ path: 'nested/head', sha: tip });

    expect((await target.git(['-C', 'nested/head', 'rev-parse', 'HEAD'])).trim()).toBe(tip);
  });

  describe('over HTTP, from a server that requires the token', () => {
    const TOKEN = 'e2e-token';
    const EXPECTED = `basic ${basicCredentials(TOKEN)}`;
    let http: GitHttpServer;

    beforeEach(async () => {
      http = await startGitHttpServer(path.join(root, 'server'), EXPECTED);
    });

    afterEach(async () => {
      await http.close();
    });

    it('sends the token with every request of the fetch', async () => {
      const result = await fetch({ server_url: http.url, sha: pullHead, token: TOKEN });

      expect(result.outputs.sha).toBe(pullHead);
      expect(http.authorizations.length).toBeGreaterThan(0);
      expect(http.authorizations.every((authorization) => authorization === EXPECTED)).toBe(true);
      expect(await checkedOutFiles()).toEqual([]);
    });

    it('masks both encodings of the token and never writes it to the repository config', async () => {
      const result = await fetch({ server_url: http.url, sha: tip, token: TOKEN });

      expect(result.masks).toEqual(expect.arrayContaining([basicCredentials(TOKEN), authorizationHeader(TOKEN)]));
      const config = await readFile(path.join(target.path, '.git', 'config'), 'utf8');
      expect(config).not.toMatch(/extraheader|basic|e2e-token/i);
    });

    it.each([
      { description: 'without a token', token: '' },
      { description: 'with the wrong token', token: 'not-the-token' },
    ])('is refused $description and leaves the workspace empty', async ({ token }) => {
      const result = await fetch({ server_url: http.url, sha: tip, token }, 'failure');

      expect(result.errors.join('\n')).toMatch(/git fetch failed/);
      expect(http.authorizations.length).toBeGreaterThan(0);
      expect(await readdir(target.path)).toEqual([]);
    });

    it('fetches anonymously even when an earlier step left an authorization header in the environment', async () => {
      const result = await fetch({ server_url: http.url, sha: tip, token: '' }, 'failure', {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraheader',
        GIT_CONFIG_VALUE_0: authorizationHeader(TOKEN),
      });

      expect(result.errors.join('\n')).toMatch(/git fetch failed/);
      expect(http.authorizations).not.toContain(EXPECTED);
    });

    it('fetches anonymously even when the global git configuration holds an authorization header', async () => {
      const globalConfig = path.join(root, 'gitconfig');
      await writeFile(globalConfig, `[http]\n\textraheader = ${authorizationHeader(TOKEN)}\n`);

      const result = await fetch({ server_url: http.url, sha: tip, token: '' }, 'failure', {
        GIT_CONFIG_GLOBAL: globalConfig,
      });

      expect(result.errors.join('\n')).toMatch(/git fetch failed/);
      expect(http.authorizations).not.toContain(EXPECTED);
    });
  });

  it.each([
    { description: 'an abbreviated SHA', inputs: { sha: 'abc1234' }, reason: /sha must be a full 40-character/ },
    { description: 'a branch name', inputs: { sha: 'main' }, reason: /sha must be a full 40-character/ },
    {
      description: 'a repository that is not owner/repo',
      inputs: { repository: 'owner', sha: 'a'.repeat(40) },
      reason: /repository must be owner\/repo/,
    },
    {
      description: 'an ssh server URL',
      inputs: { server_url: 'ssh://git@github.com', sha: 'a'.repeat(40) },
      reason: /server_url must be an https, http or file URL/,
    },
    {
      description: 'a path outside the workspace',
      inputs: { path: '../elsewhere', sha: 'a'.repeat(40) },
      reason: /path must not traverse upwards/,
    },
  ])('refuses $description before fetching anything', async ({ inputs, reason }) => {
    const result = await fetch(inputs, 'failure');

    expect(result.errors.join('\n')).toMatch(reason);
    expect(await target.exists('.git')).toBe(false);
  });

  it('refuses a workspace that already holds files', async () => {
    await target.write({ 'keep.txt': 'mine\n' });

    const result = await fetch({ sha: tip }, 'failure');

    expect(result.errors.join('\n')).toMatch(/path must be empty or not exist yet/);
    expect(await target.exists('.git')).toBe(false);
    expect(await target.read('keep.txt')).toBe('mine\n');
  });

  it.skipIf(!SYMLINKS_SUPPORTED)('refuses a path that leaves the workspace through a symbolic link', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await target.symlink('escape', outside);

    const result = await fetch({ path: 'escape', sha: tip }, 'failure');

    expect(result.errors.join('\n')).toMatch(/path resolves outside the workspace through a symbolic link/);
    expect(await readdir(outside)).toEqual([]);
  });

  it('fails for a commit the server does not have, and removes the repository it created', async () => {
    const result = await fetch({ sha: 'f'.repeat(40) }, 'failure');

    expect(result.errors.join('\n')).toMatch(/git fetch failed/);
    expect(result.outputs.sha).toBeUndefined();
    expect(await readdir(target.path)).toEqual([]);
  });
});
