import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  authEnvironment,
  authorizationHeader,
  basicCredentials,
  fetchHead,
  FetchHeadInputError,
  prepareDirectory,
  repositoryEnvironment,
  repositoryUrl,
  validateRequest,
} from './fetch-head.js';

import type { FetchHeadRequest, GitRunner } from './fetch-head.js';

const SHA = 'a'.repeat(40);

describe('validateRequest', () => {
  const valid: FetchHeadRequest = {
    directory: '/unused',
    repository: 'owner/repo',
    serverUrl: 'https://github.com',
    sha: SHA,
    token: 'secret',
  };

  it('accepts a full SHA, owner/repo and an https server', () => {
    expect(() => validateRequest(valid)).not.toThrow();
  });

  it.each(['http://localhost:8080', 'http://127.0.0.1', 'http://[::1]:9000'])(
    'sends a token over plain http to the loopback server %s',
    (serverUrl) => {
      expect(() => validateRequest({ ...valid, serverUrl })).not.toThrow();
    },
  );

  it('fetches anonymously over plain http from any host', () => {
    expect(() => validateRequest({ ...valid, serverUrl: 'http://ghe.example.com', token: '' })).not.toThrow();
  });

  it.each([
    { field: 'sha', value: 'a'.repeat(39), reason: /sha must be a full 40-character/ },
    { field: 'sha', value: 'A'.repeat(40), reason: /sha must be a full 40-character/ },
    { field: 'sha', value: 'main', reason: /sha must be a full 40-character/ },
    { field: 'sha', value: `${SHA}\n`, reason: /sha must be a full 40-character/ },
    { field: 'repository', value: 'owner', reason: /repository must be owner\/repo/ },
    { field: 'repository', value: 'owner/repo/extra', reason: /repository must be owner\/repo/ },
    { field: 'serverUrl', value: 'github.com', reason: /server_url must be a URL/ },
    { field: 'serverUrl', value: 'ssh://git@github.com', reason: /server_url must be an https, http or file URL/ },
    { field: 'serverUrl', value: 'ext::sh -c touch', reason: /server_url must be/ },
    { field: 'serverUrl', value: 'http://ghe.example.com', reason: /server_url must be https to send a token/ },
  ] as const)('refuses $field $value', ({ field, value, reason }) => {
    expect(() => validateRequest({ ...valid, [field]: value })).toThrow(reason);
    expect(() => validateRequest({ ...valid, [field]: value })).toThrow(FetchHeadInputError);
  });
});

describe('authEnvironment', () => {
  it('is empty without a token', () => {
    expect(authEnvironment('https://github.com', '')).toEqual({});
  });

  it('scopes the header to the server origin', () => {
    expect(authEnvironment('https://ghe.example.com/', 'secret')).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://ghe.example.com/.extraheader',
      GIT_CONFIG_VALUE_0: authorizationHeader('secret'),
    });
  });

  it('gives a file server no token, since no header reaches it', () => {
    expect(authEnvironment('file:///srv/git', 'secret')).toEqual({});
  });

  it('sends the token as the basic password, as actions/checkout does', () => {
    expect(Buffer.from(basicCredentials('secret'), 'base64').toString('utf8')).toBe('x-access-token:secret');
    expect(authorizationHeader('secret')).toBe(`AUTHORIZATION: basic ${basicCredentials('secret')}`);
  });
});

describe('repositoryEnvironment', () => {
  it('pins every location git would otherwise take from the environment to the new repository', () => {
    const directory = path.join(tmpdir(), 'repo');
    const gitDirectory = path.join(directory, '.git');

    expect(repositoryEnvironment(directory)).toEqual({
      GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
      GIT_COMMON_DIR: gitDirectory,
      GIT_DIR: gitDirectory,
      GIT_INDEX_FILE: path.join(gitDirectory, 'index'),
      GIT_OBJECT_DIRECTORY: path.join(gitDirectory, 'objects'),
      GIT_WORK_TREE: directory,
    });
  });
});

describe('repositoryUrl', () => {
  it.each([
    ['https://github.com', 'https://github.com/owner/repo.git'],
    ['https://github.com/', 'https://github.com/owner/repo.git'],
    ['file:///srv/git', 'file:///srv/git/owner/repo.git'],
  ])('joins %s', (server, url) => {
    expect(repositoryUrl(server, 'owner/repo')).toBe(url);
  });
});

describe('prepareDirectory', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fetch-head-unit-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('creates a missing directory', async () => {
    const target = path.join(root, 'a', 'b');

    await prepareDirectory(target, 'path');

    expect(await readdir(target)).toEqual([]);
  });

  it('accepts an empty directory', async () => {
    await expect(prepareDirectory(root, 'path')).resolves.toBeUndefined();
  });

  it('refuses a directory that holds a file', async () => {
    await writeFile(path.join(root, 'file'), 'x');

    await expect(prepareDirectory(root, 'path')).rejects.toThrow(
      /path must be empty or not exist yet, but holds 1 entry/,
    );
  });

  it('refuses a directory that already holds a repository', async () => {
    await mkdir(path.join(root, '.git'));

    await expect(prepareDirectory(root, 'path')).rejects.toThrow(FetchHeadInputError);
  });
});

describe('fetchHead', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fetch-head-unit-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  function request(overrides: Partial<FetchHeadRequest> = {}): FetchHeadRequest {
    return {
      directory: root,
      repository: 'owner/repo',
      serverUrl: 'https://github.com',
      sha: SHA,
      token: 'secret',
      ...overrides,
    };
  }

  /** A git stand-in that records every call and answers rev-parse with `head`. */
  function recorder(head = SHA): {
    calls: { args: readonly string[]; env: Readonly<Record<string, string>> }[];
    git: GitRunner;
  } {
    const calls: { args: readonly string[]; env: Readonly<Record<string, string>> }[] = [];
    const git: GitRunner = (args, _cwd, env) => {
      calls.push({ args, env });
      return Promise.resolve(args[0] === 'rev-parse' ? head : '');
    };

    return { calls, git };
  }

  it('initialises, fetches the one commit, and detaches HEAD on it', async () => {
    const { calls, git } = recorder();

    await expect(fetchHead(request(), git)).resolves.toBe(SHA);

    expect(calls.map((call) => call.args[0])).toEqual(['init', 'fetch', 'update-ref', 'rev-parse']);
    expect(calls[1]?.args).toEqual([
      'fetch',
      '--quiet',
      '--depth=1',
      '--no-tags',
      '--no-recurse-submodules',
      'https://github.com/owner/repo.git',
      SHA,
    ]);
    expect(calls[2]?.args).toEqual(['update-ref', '--no-deref', 'HEAD', SHA]);
  });

  it('gives the token to the fetch only', async () => {
    const { calls, git } = recorder();

    await fetchHead(request(), git);

    const withToken = calls.filter((call) => 'GIT_CONFIG_COUNT' in call.env).map((call) => call.args[0]);
    expect(withToken).toEqual(['fetch']);
  });

  it('pins every command to the new repository', async () => {
    const { calls, git } = recorder();

    await fetchHead(request(), git);

    expect(calls.map((call) => call.env['GIT_DIR'])).toEqual(Array(4).fill(path.join(root, '.git')));
  });

  it('removes the repository it created when git fails, so the step can be re-run', async () => {
    const git: GitRunner = async (args, cwd) => {
      if (args[0] === 'init') {
        await mkdir(path.join(cwd, '.git'));
        return '';
      }
      throw new Error('git fetch failed: not our ref');
    };

    await expect(fetchHead(request(), git)).rejects.toThrow(/not our ref/);

    expect(await readdir(root)).toEqual([]);
  });

  it('fetches anonymously without a token', async () => {
    const { calls, git } = recorder();

    await fetchHead(request({ token: '' }), git);

    expect(calls.some((call) => 'GIT_CONFIG_COUNT' in call.env)).toBe(false);
  });

  it('fails when HEAD does not resolve to the commit', async () => {
    const { git } = recorder('b'.repeat(40));

    await expect(fetchHead(request(), git)).rejects.toThrow(/HEAD resolves to/);
  });

  it('runs no git command for a refused input', async () => {
    const { calls, git } = recorder();

    await expect(fetchHead(request({ sha: 'main' }), git)).rejects.toThrow(FetchHeadInputError);

    expect(calls).toEqual([]);
  });

  it('runs no git command over a non-empty directory', async () => {
    await writeFile(path.join(root, 'file'), 'x');
    const { calls, git } = recorder();

    await expect(fetchHead(request(), git)).rejects.toThrow(FetchHeadInputError);

    expect(calls).toEqual([]);
  });
});
