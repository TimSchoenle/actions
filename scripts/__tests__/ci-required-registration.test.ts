import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import {
  collectRegistration,
  formatOutputs,
  main,
  type RegistrationApi,
  type RegistrationContext,
  restApi,
} from '../lib/ci-required-registration-step.js';
import { isVerifyWorkflowFile } from '../lib/ci-required.js';
import {
  type ChangedFile,
  evaluateRegistration,
  globToRegExp,
  matchesPatternList,
  PATH_FILTER_FILE_LIMIT,
  type PullRequestChange,
  pullRequestFilterOf,
  type RegistrationInput,
  runsForPullRequest,
  type VerifyWorkflow,
} from '../lib/ci-required-registration.js';
import { ROOT_DIR } from '../lib/utils.js';

const WORKFLOWS_DIR = path.join(ROOT_DIR, '.github', 'workflows');
const SHA = 'c'.repeat(40);

const modified = (filename: string): ChangedFile => ({ filename, status: 'modified' });
const change = (files: ChangedFile[], baseRef = 'main'): PullRequestChange => ({ number: 7, baseRef, files });

describe('globToRegExp', () => {
  // Cases from the filter pattern cheat sheet of the GitHub Actions workflow syntax reference.
  it.each([
    ['*', 'README.md', true],
    ['*', 'docs/README.md', false],
    ['*.js', 'app.js', true],
    ['*.js', 'src/app.js', false],
    ['**', 'all/the/files.md', true],
    ['**.js', 'js/index.js', true],
    ['docs/*', 'docs/README.md', true],
    ['docs/*', 'docs/a/README.md', false],
    ['docs/**', 'docs/mona/octocat.txt', true],
    ['docs/**/*.md', 'docs/a/b/c/README.md', true],
    ['docs/**/*.md', 'docs/README.md', true],
    ['**/docs/**', 'docs/hello.md', true],
    ['**/docs/**', 'dir/docs/my-file.txt', true],
    ['**/README.md', 'README.md', true],
    ['**/README.md', 'js/README.md', true],
    ['**/*src/**', 'a/src/app.js', true],
    ['**/*-post.md', 'my-post.md', true],
    ['**/migrate-*.sql', 'db/sept/migrate-v1.sql', true],
    ['*.md', 'README.mdx', false],
    ['a?b', 'ab', true],
    ['a?b', 'aab', false],
    ['a+b', 'aaab', true],
    ['a+b', 'b', false],
    ['v[12].txt', 'v2.txt', true],
    ['v[a-c].txt', 'vd.txt', false],
    [String.raw`\*.txt`, '*.txt', true],
    [String.raw`\*.txt`, 'a.txt', false],
    ['renovate.json', 'renovate.json', true],
    ['renovate.json', 'renovateXjson', false],
  ])('%s against %s is %s', (pattern, file, expected) => {
    expect(globToRegExp(pattern).test(file)).toBe(expected);
  });

  it.each(['?a', '+a', '[a_b]', '[unclosed'])('rejects the pattern %s it cannot model', (pattern) => {
    expect(() => globToRegExp(pattern)).toThrow(/Filter pattern/);
  });
});

describe('matchesPatternList', () => {
  const patterns = ['actions/x/**', '!actions/x/CHANGELOG.md', 'actions/x/CHANGELOG.md.d/**'];

  it.each([
    ['actions/x/action.yaml', true],
    ['actions/x/CHANGELOG.md', false],
    ['actions/x/CHANGELOG.md.d/entry', true],
    ['actions/y/action.yaml', false],
  ])('lets the last matching pattern decide for %s', (file, expected) => {
    expect(matchesPatternList(file, patterns)).toBe(expected);
  });
});

describe('pullRequestFilterOf', () => {
  it.each([
    ['the scalar form', 'on: pull_request\n', {}],
    ['the sequence form', 'on: [push, pull_request]\n', {}],
    ['an empty mapping entry', 'on:\n  pull_request:\n', {}],
  ])('reads %s as unfiltered', (_form, content, expected) => {
    expect(pullRequestFilterOf('w.yml', content)).toMatchObject(expected);
    expect(pullRequestFilterOf('w.yml', content)?.paths).toBeUndefined();
  });

  it.each([
    ['no trigger', 'name: x\n'],
    ['a scalar push trigger', 'on: push\n'],
    ['a sequence without pull_request', 'on: [push]\n'],
    ['a mapping without pull_request', 'on:\n  push:\n'],
  ])('reports no pull_request trigger for %s', (_form, content) => {
    expect(pullRequestFilterOf('w.yml', content)).toBeUndefined();
  });

  it('reads every filter, in scalar or sequence form', () => {
    const content = [
      'on:',
      '  pull_request:',
      '    branches: main',
      '    paths-ignore: [docs/**]',
      '    types: [opened]',
      '',
    ].join('\n');

    expect(pullRequestFilterOf('w.yml', content)).toEqual({
      branches: ['main'],
      branchesIgnore: undefined,
      paths: undefined,
      pathsIgnore: ['docs/**'],
      types: ['opened'],
    });
  });

  it.each([
    ['branches and branches-ignore', 'branches: [main]\n    branches-ignore: [dev]', /both branches/],
    ['paths and paths-ignore', 'paths: [a]\n    paths-ignore: [b]', /both paths/],
    ['a non-string entry', 'paths: [1]', /paths must be/],
  ])('rejects %s', (_case, body, error) => {
    expect(() => pullRequestFilterOf('w.yml', `on:\n  pull_request:\n    ${body}\n`)).toThrow(error);
  });
});

describe('runsForPullRequest', () => {
  it('runs without filters', () => {
    expect(runsForPullRequest({}, change([modified('anything')]))).toBe(true);
  });

  it('applies paths to any changed file', () => {
    const filter = { paths: ['actions/x/**', '!actions/x/CHANGELOG.md'] };

    expect(runsForPullRequest(filter, change([modified('README.md'), modified('actions/x/a.ts')]))).toBe(true);
    expect(runsForPullRequest(filter, change([modified('actions/x/CHANGELOG.md')]))).toBe(false);
  });

  it('runs on paths-ignore unless every changed file is ignored', () => {
    const filter = { pathsIgnore: ['docs/**'] };

    expect(runsForPullRequest(filter, change([modified('docs/a.md')]))).toBe(false);
    expect(runsForPullRequest(filter, change([modified('docs/a.md'), modified('src/a.ts')]))).toBe(true);
  });

  it('filters on the base branch', () => {
    const files = [modified('a')];

    expect(runsForPullRequest({ branches: ['main'] }, change(files, 'release/1'))).toBe(false);
    expect(runsForPullRequest({ branches: ['release/**'] }, change(files, 'release/1'))).toBe(true);
    expect(runsForPullRequest({ branchesIgnore: ['release/**'] }, change(files, 'release/1'))).toBe(false);
    expect(runsForPullRequest({ branchesIgnore: ['release/**'] }, change(files, 'main'))).toBe(true);
  });

  it('only waits for workflows that run on every event that creates a head commit', () => {
    const files = [modified('a')];

    expect(runsForPullRequest({ types: ['opened', 'synchronize', 'reopened', 'labeled'] }, change(files))).toBe(true);
    expect(runsForPullRequest({ types: ['labeled'] }, change(files))).toBe(false);
  });
});

describe('evaluateRegistration', () => {
  const workflows: VerifyWorkflow[] = [
    { path: '.github/workflows/verify-action-a.yaml', pullRequest: { paths: ['actions/a/**'] } },
    { path: '.github/workflows/verify-action-b.yaml', pullRequest: { paths: ['actions/b/**'] } },
    { path: '.github/workflows/verify-config-c.yaml', pullRequest: undefined },
  ];
  const input = (overrides: Partial<RegistrationInput>): RegistrationInput => ({
    event: 'pull_request',
    workflows,
    pullRequests: [change([modified('actions/a/x.ts'), modified('actions/b/y.ts')])],
    runs: [],
    ...overrides,
  });

  // The race the barrier exists for: Scripts CI completes before GitHub has created the verify run.
  it('reports an applicable verify workflow without a run as missing', () => {
    const registration = evaluateRegistration(
      input({ runs: [{ path: '.github/workflows/verify-action-a.yaml', status: 'completed' }] }),
    );

    expect(registration).toEqual({
      scope: 'pull-request',
      applicable: ['.github/workflows/verify-action-a.yaml', '.github/workflows/verify-action-b.yaml'],
      missing: ['.github/workflows/verify-action-b.yaml'],
      unfinished: 0,
      expected: 2,
    });
  });

  it('counts unfinished verify runs and ignores every other run', () => {
    const registration = evaluateRegistration(
      input({
        runs: [
          { path: '.github/workflows/verify-action-a.yaml', status: 'in_progress' },
          { path: '.github/workflows/verify-action-b.yaml@refs/pull/7/merge', status: 'queued' },
          { path: '.github/workflows/scripts-ci.yml', status: 'in_progress' },
          { path: 'other/verify-action-a.yaml', status: 'in_progress' },
        ],
      }),
    );

    expect(registration.missing).toEqual([]);
    expect(registration.unfinished).toBe(2);
  });

  it('expects nothing when no verify workflow applies', () => {
    const registration = evaluateRegistration(input({ pullRequests: [change([modified('README.md')])] }));

    expect(registration).toMatchObject({ scope: 'pull-request', applicable: [], missing: [], expected: 0 });
  });

  it.each([
    ['removes', { filename: '.github/workflows/verify-action-a.yaml', status: 'removed' }],
    [
      'renames',
      {
        filename: '.github/workflows/verify-action-z.yaml',
        status: 'renamed',
        previous_filename: '.github/workflows/verify-action-a.yaml',
      },
    ],
  ])('does not wait for a workflow the pull request %s', (_verb, file) => {
    const self = { path: '.github/workflows/verify-action-a.yaml', pullRequest: { paths: ['.github/workflows/**'] } };
    const registration = evaluateRegistration(input({ workflows: [self], pullRequests: [change([file])] }));

    expect(registration.applicable).toEqual([]);
  });

  it('expects the union over every pull request at the head', () => {
    const registration = evaluateRegistration(
      input({ pullRequests: [change([modified('actions/a/x.ts')]), change([modified('actions/b/y.ts')], 'main')] }),
    );

    expect(registration.applicable).toHaveLength(2);
  });

  it('stands down beyond the path filter file limit', () => {
    const files = Array.from({ length: PATH_FILTER_FILE_LIMIT + 1 }, (_, index) => modified(`f${index}`));
    const registration = evaluateRegistration(
      input({
        pullRequests: [change(files)],
        runs: [{ path: '.github/workflows/verify-action-a.yaml', status: 'completed' }],
      }),
    );

    expect(registration).toEqual({ scope: 'too-many-files', applicable: [], missing: [], unfinished: 0, expected: 1 });
  });

  it.each([
    ['pull_request', 'unresolved'],
    ['push', 'no-pull-request'],
  ])('without an open pull request, a %s run is %s', (event, scope) => {
    expect(evaluateRegistration(input({ event, pullRequests: [] })).scope).toBe(scope);
  });
});

// The barrier reads the real default-branch filters, so every one of them has to be modelled.
describe('the verify workflows on disk', () => {
  const verifyFiles = fs.readdirSync(WORKFLOWS_DIR).filter(isVerifyWorkflowFile);
  const workflowsOnDisk: VerifyWorkflow[] = verifyFiles.map((file) => ({
    path: `.github/workflows/${file}`,
    pullRequest: pullRequestFilterOf(file, fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8')),
  }));

  it('all run on pull requests, with filters the barrier models', () => {
    expect(workflowsOnDisk.length).toBeGreaterThan(0);
    for (const { path: file, pullRequest } of workflowsOnDisk) {
      expect(pullRequest, file).toBeDefined();
      expect(() => runsForPullRequest(pullRequest ?? {}, change([modified('x')])), file).not.toThrow();
    }
  });

  it.each(workflowsOnDisk.map(({ path: file }) => file))('%s applies to a change of its own file', (file) => {
    const registration = evaluateRegistration({
      event: 'pull_request',
      workflows: workflowsOnDisk,
      pullRequests: [change([modified(file)])],
      runs: [],
    });

    expect(registration.applicable).toContain(file);
  });

  it('applies to a change of an action only the workflows that verify it', () => {
    const registration = evaluateRegistration({
      event: 'pull_request',
      workflows: workflowsOnDisk,
      pullRequests: [change([modified('actions/bun/setup-cached/action.yaml')])],
      runs: [],
    });

    expect(registration.applicable).toEqual(['.github/workflows/verify-action-bun-setup-cached.yaml']);
  });
});

describe('ci-required-registration entry point', () => {
  const context: RegistrationContext = {
    repository: 'owner/repo',
    sha: SHA,
    event: 'pull_request',
    headOwner: 'fork-owner',
    headBranch: 'feature/x',
  };
  let rootDir: string;
  let outputFile: string;

  /** Answers each endpoint from a table, by path without the query string, and records the calls. */
  function fakeApi(routes: Record<string, (query: URLSearchParams) => unknown>): RegistrationApi & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      get<T>(endpoint: string): Promise<T> {
        calls.push(endpoint);
        const [route, query] = endpoint.split('?');
        const handler = routes[route];
        if (!handler) {
          return Promise.reject(new Error(`unexpected GET ${endpoint}`));
        }
        return Promise.resolve(handler(new URLSearchParams(query)) as T);
      },
    };
  }

  function writeWorkflow(file: string, content: string): void {
    fs.writeFileSync(path.join(rootDir, '.github', 'workflows', file), content);
  }

  const page = <T>(query: URLSearchParams, entries: T[]): T[] =>
    entries.slice((Number(query.get('page')) - 1) * 100, Number(query.get('page')) * 100);

  function routes(files: ChangedFile[]): Record<string, (query: URLSearchParams) => unknown> {
    return {
      '/repos/owner/repo/actions/workflows': () => ({
        workflows: [
          { path: '.github/workflows/verify-action-a.yaml', state: 'active' },
          { path: '.github/workflows/verify-action-b.yaml', state: 'disabled_manually' },
        ],
      }),
      '/repos/owner/repo/pulls': (query) =>
        query.get('head') === 'fork-owner:feature/x'
          ? [
              { number: 7, head: { sha: SHA }, base: { ref: 'main' } },
              { number: 8, head: { sha: 'd'.repeat(40) }, base: { ref: 'main' } },
            ]
          : [],
      '/repos/owner/repo/pulls/7/files': (query) => page(query, files),
      '/repos/owner/repo/actions/runs': (query) => ({
        workflow_runs:
          query.get('head_sha') === SHA
            ? [{ path: '.github/workflows/scripts-ci.yml', status: 'completed', id: 1 }]
            : [],
      }),
    };
  }

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-required-registration-'));
    fs.mkdirSync(path.join(rootDir, '.github', 'workflows'), { recursive: true });
    writeWorkflow('verify-action-a.yaml', 'on:\n  pull_request:\n    paths: [actions/a/**]\n');
    writeWorkflow('verify-action-b.yaml', 'on:\n  pull_request:\n    paths: [actions/b/**]\n');
    writeWorkflow('scripts-ci.yml', 'on:\n  pull_request:\n');
    outputFile = path.join(rootDir, 'output');
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('finds a fork pull request by head branch and waits for its enabled verify workflows', async () => {
    const api = fakeApi(routes([modified('actions/a/x.ts'), modified('actions/b/y.ts')]));
    const registration = await collectRegistration(api, context, rootDir);

    expect(registration).toEqual({
      scope: 'pull-request',
      applicable: ['.github/workflows/verify-action-a.yaml'],
      missing: ['.github/workflows/verify-action-a.yaml'],
      unfinished: 0,
      expected: 1,
    });
    expect(api.calls).not.toContain('/repos/owner/repo/pulls/8/files?per_page=100&page=1');
  });

  it('reads changed files only one past the path filter limit', async () => {
    const files = Array.from({ length: 450 }, (_, index) => modified(`f${index}`));
    const api = fakeApi(routes(files));
    const registration = await collectRegistration(api, context, rootDir);

    expect(registration.scope).toBe('too-many-files');
    expect(api.calls.filter((call) => call.startsWith('/repos/owner/repo/pulls/7/files'))).toHaveLength(4);
  });

  it('writes the decision to GITHUB_OUTPUT', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', context.repository);
    vi.stubEnv('HEAD_SHA', SHA);
    vi.stubEnv('TRIGGER_EVENT', 'pull_request');
    vi.stubEnv('HEAD_OWNER', context.headOwner);
    vi.stubEnv('HEAD_BRANCH', context.headBranch);
    vi.stubEnv('GITHUB_OUTPUT', outputFile);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main(fakeApi(routes([modified('actions/a/x.ts')])), rootDir);

    expect(fs.readFileSync(outputFile, 'utf8')).toBe(
      [
        'scope=pull-request',
        'applicable=1',
        'missing=1',
        'missing_workflows=verify-action-a.yaml',
        'unfinished=0',
        'expected=1',
        '',
      ].join('\n'),
    );
  });

  it('reads through the REST client when no API is passed', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', context.repository);
    vi.stubEnv('GITHUB_TOKEN', 'token-value');
    vi.stubEnv('HEAD_SHA', SHA);
    vi.stubEnv('TRIGGER_EVENT', 'push');
    vi.stubEnv('HEAD_OWNER', 'owner');
    vi.stubEnv('HEAD_BRANCH', 'main');
    vi.stubEnv('GITHUB_OUTPUT', outputFile);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const bodies: Record<string, unknown> = {
      workflows: { workflows: [] },
      pulls: [],
      runs: { workflow_runs: [] },
    };
    const fetchMock = vi.fn((url: string) => {
      const key = Object.keys(bodies).find((name) => new URL(url).pathname.endsWith(`/${name}`));
      return Promise.resolve(new Response(JSON.stringify(key ? bodies[key] : null), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(main(undefined, rootDir)).resolves.toMatchObject({ scope: 'no-pull-request', applicable: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain('scope=no-pull-request\n');
  });

  it.each([
    ['a missing variable', { HEAD_SHA: '' }, /HEAD_SHA is required/],
    ['a malformed SHA', { HEAD_SHA: 'main' }, /is not a commit SHA/],
  ])('refuses %s', async (_case, overrides: Record<string, string>, error) => {
    const environment = {
      GITHUB_REPOSITORY: context.repository,
      HEAD_SHA: SHA,
      TRIGGER_EVENT: 'pull_request',
      HEAD_OWNER: context.headOwner,
      HEAD_BRANCH: context.headBranch,
      GITHUB_OUTPUT: outputFile,
      ...overrides,
    };
    for (const [name, value] of Object.entries(environment)) {
      vi.stubEnv(name, value);
    }

    await expect(main(fakeApi({}), rootDir)).rejects.toThrow(error);
  });

  it('formats an empty missing list', () => {
    expect(
      formatOutputs({ scope: 'no-pull-request', applicable: [], missing: [], unfinished: 0, expected: 0 }),
    ).toContain('missing_workflows=\n');
  });

  describe('restApi', () => {
    it('sends an authenticated, versioned GET and parses the body', async () => {
      vi.stubEnv('GITHUB_API_URL', '');
      const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(restApi('token-value').get('/repos/owner/repo')).resolves.toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo',
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'Bearer token-value',
            'x-github-api-version': '2022-11-28',
          }),
        }),
      );
    });

    it.each([
      ['the runner API URL', 'https://ghe.example.invalid/api/v3', 'https://ghe.example.invalid/api/v3/x'],
      ['github.com without one', '', 'https://api.github.com/x'],
    ])('reads from %s', async (_case, apiUrl, expected) => {
      vi.stubEnv('GITHUB_API_URL', apiUrl);
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await restApi('token-value').get('/x');

      expect(fetchMock).toHaveBeenCalledWith(expected, expect.anything());
    });

    it('fails on an error status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404, statusText: 'Not Found' })));

      await expect(restApi('token-value').get('/missing')).rejects.toThrow('GET /missing failed: 404 Not Found');
    });
  });
});

// Runs the gate's real publish script under bash, with `gh` replaced by a stub that records the
// status it would post, so each verdict is checked as the shell computes it.
describe('ci-required publish step', () => {
  interface Step {
    name?: string;
    run?: string;
  }
  const workflow = parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'ci-required.yaml'), 'utf8')) as {
    jobs: { gate: { steps: Step[] } };
  };
  const script = workflow.jobs.gate.steps.find((step) => step.name === 'Publish ci-required status')?.run ?? '';
  let binDir: string;

  beforeEach(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-required-publish-'));
    fs.writeFileSync(path.join(binDir, 'gh'), '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$GH_ARGS_FILE"\n', {
      mode: 0o755,
    });
  });

  afterEach(() => {
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  function publish(overrides: Record<string, string>): { exitCode: number; state?: string; description?: string } {
    const argsFile = path.join(binDir, 'args');
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        GH_ARGS_FILE: argsFile,
        REPO: 'owner/repo',
        SHA,
        RUN_URL: 'https://example.invalid/run',
        SCOPE: 'pull-request',
        APPLICABLE: '1',
        MISSING: '0',
        MISSING_WORKFLOWS: '',
        UNFINISHED: '0',
        EXPECTED: '1',
        MATCHED: '1',
        FAILED: '0',
        ...overrides,
      },
    });
    const args = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').split('\n') : [];
    const field = (name: string): string | undefined =>
      args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);

    return { exitCode: result.status ?? -1, state: field('state'), description: field('description') };
  }

  it.each([
    [
      'an applicable workflow has no run yet',
      { MISSING: '1', MISSING_WORKFLOWS: 'verify-action-a.yaml', MATCHED: '0', EXPECTED: '1' },
      'pending',
      'Waiting for 1 applicable verify workflow(s) to start.',
    ],
    ['a verify run is unfinished', { UNFINISHED: '2' }, 'pending', 'Waiting for 2 verify workflow run(s) to finish.'],
    [
      'an expected workflow reported no check',
      { MATCHED: '0' },
      'failure',
      `No verify checks found at ${SHA.slice(0, 7)}; check ref/patterns.`,
    ],
    ['a check failed', { FAILED: '1' }, 'failure', '1 verify check(s) not in the expected state.'],
    [
      'no verify workflow applies',
      { APPLICABLE: '0', EXPECTED: '0', MATCHED: '0' },
      'success',
      'No verify workflow applies to this change.',
    ],
    ['every check passed', {}, 'success', 'All 1 verify check(s) passed.'],
    [
      'the pull request is not found',
      { SCOPE: 'unresolved', APPLICABLE: '0', EXPECTED: '0', MATCHED: '0' },
      'failure',
      `No open pull request has head ${SHA.slice(0, 7)}; re-run to retry.`,
    ],
    [
      'the barrier stood down and nothing ran',
      { SCOPE: 'too-many-files', APPLICABLE: '0', EXPECTED: '0', MATCHED: '0' },
      'success',
      'All 0 verify check(s) passed.',
    ],
  ])('when %s, reports %s', (_case, overrides, state, description) => {
    const outcome = publish(overrides);

    expect(outcome).toEqual({ exitCode: state === 'failure' ? 1 : 0, state, description });
  });

  it.each(['SCOPE', 'APPLICABLE', 'MISSING', 'UNFINISHED', 'EXPECTED'])(
    'fails without posting when the registration output %s is empty',
    (name) => {
      expect(publish({ [name]: '' })).toEqual({ exitCode: 1, state: undefined, description: undefined });
    },
  );
});
