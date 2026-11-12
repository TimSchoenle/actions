import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { changedFiles, gitIn, main, plan, PLAN_FILE } from '../plan-step.js';

import type { PlanFile } from '../affected.js';
import type { CheckRun } from '../merged-head.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('changedFiles', () => {
  it('diffs a pull request against the merge base', () => {
    const calls: string[][] = [];
    const git = (args: readonly string[]): string => {
      calls.push([...args]);
      return args[0] === 'merge-base' ? `${SHA_A}\n` : 'a.ts\0b/c.ts\0';
    };

    expect(changedFiles(git, { kind: 'merge-base', base: SHA_B, head: SHA_A })).toEqual({
      changed: ['a.ts', 'b/c.ts'],
      base: SHA_A,
    });
    expect(calls).toEqual([
      ['merge-base', SHA_B, SHA_A],
      ['diff', '--name-only', '-z', '--no-renames', SHA_A, SHA_A],
    ]);
  });

  // C3e: without -z git quotes such a name, "docs/\303\244.md", which then matches no input.
  it('keeps a non-ASCII or space-padded name exactly as committed', () => {
    const git = (): string => 'docs/ä.md\0 lead.txt\0';

    expect(changedFiles(git, { kind: 'range', from: SHA_A, to: SHA_B }).changed).toEqual(['docs/ä.md', ' lead.txt']);
  });

  it('selects everything, with a note, when git cannot compute the diff', () => {
    const git = (): string => {
      throw new Error('fatal: bad object');
    };

    const result = changedFiles(git, { kind: 'range', from: SHA_A, to: SHA_B });

    expect(result.changed).toBe('all');
    expect(result.note).toMatch(/fatal: bad object/);
  });

  it('selects everything for a request that has no diff', () => {
    expect(changedFiles(() => '', { kind: 'none' })).toEqual({ changed: 'all' });
    expect(changedFiles(() => '', { kind: 'all', reason: 'new branch' }).note).toMatch(/new branch/);
  });
});

describe('plan against a real repository', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  /** A git repository with a plan file and two commits; returns its root and both SHAs. */
  function repository(): { root: string; before: string; after: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-plan-'));
    directories.push(root);
    const git = gitIn(root);
    const planFile: PlanFile = {
      global: ['scripts/verify-plan.ts'],
      ignore: ['**/CHANGELOG.md'],
      sharedJobsSha256: 'shared',
      targets: [
        {
          id: 'common/a',
          shard: 'verify-common',
          e2eGroup: null,
          inputs: ['actions/common/a'],
          buildDirs: ['actions/common/a'],
          install: true,
          pullRequestBranches: null,
          pushBranches: ['feature/common/a'],
          schedule: false,
          jobsSha256: 'a1',
        },
        {
          id: 'common/b',
          shard: 'verify-common',
          e2eGroup: null,
          inputs: ['actions/common/b'],
          buildDirs: [],
          install: false,
          pullRequestBranches: null,
          pushBranches: ['feature/common/b'],
          schedule: false,
          jobsSha256: 'b1',
        },
      ],
    };
    fs.mkdirSync(path.join(root, '.github', 'verify'), { recursive: true });
    fs.mkdirSync(path.join(root, 'actions', 'common', 'a'), { recursive: true });
    fs.writeFileSync(path.join(root, PLAN_FILE), JSON.stringify(planFile));
    fs.writeFileSync(path.join(root, 'actions', 'common', 'a', 'CHANGELOG.md'), 'v1\n');
    git(['init', '-q', '-b', 'main']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '.']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'one']);
    const before = git(['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(path.join(root, 'actions', 'common', 'a', 'index.ts'), 'export {};\n');
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '.']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'two']);
    const after = git(['rev-parse', 'HEAD']).trim();

    return { root, before, after };
  }

  it('selects the target a push changed', async () => {
    const { root, before, after } = repository();

    expect(
      (await plan({ EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: before, AFTER: after }, root)).result,
    ).toEqual({
      targets: ['common/a'],
      shards: ['verify-common'],
      buildDirs: ['actions/common/a'],
      e2eGroups: [],
      e2e: {},
      install: true,
      seedCache: false,
    });
  });

  it('writes the step outputs and the job summary', async () => {
    const { root, before, after } = repository();
    const output = path.join(root, 'output');
    const summary = path.join(root, 'summary');

    await main(
      {
        EVENT_NAME: 'pull_request',
        BASE_REF: 'main',
        BASE_SHA: before,
        HEAD_SHA: after,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
      },
      root,
    );

    expect(fs.readFileSync(output, 'utf8')).toContain('targets=["common/a"]\n');
    expect(fs.readFileSync(summary, 'utf8')).toContain('- `common/a`');
  });

  it('selects the target for a changed file with a non-ASCII name', async () => {
    const { root, after } = repository();
    const git = gitIn(root);
    fs.writeFileSync(path.join(root, 'actions', 'common', 'a', 'übersicht.ts'), 'export {};\n');
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '.']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'three']);
    const third = git(['rev-parse', 'HEAD']).trim();

    expect(
      (await plan({ EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: after, AFTER: third }, root)).result.targets,
    ).toEqual(['common/a']);
  });

  /** Commits a plan in which common/b's jobs changed, and nothing else. Returns the new HEAD. */
  function commitJobChange(root: string): string {
    const git = gitIn(root);
    const current = JSON.parse(fs.readFileSync(path.join(root, PLAN_FILE), 'utf8')) as PlanFile;
    const next: PlanFile = {
      ...current,
      targets: current.targets.map((entry) => (entry.id === 'common/b' ? { ...entry, jobsSha256: 'b2' } : entry)),
    };
    fs.writeFileSync(path.join(root, PLAN_FILE), JSON.stringify(next));
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qam', 'jobs']);

    return git(['rev-parse', 'HEAD']).trim();
  }

  // P1: the plan file changed, and only common/b's jobs in it, so only common/b runs.
  it('selects the target whose jobs changed, read from the base commit plan', async () => {
    const { root, after } = repository();
    const head = commitJobChange(root);

    expect(
      (await plan({ EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: after, AFTER: head }, root)).result.targets,
    ).toEqual(['common/b']);
  });

  it('selects every target, with a note, when the base commit has no plan', async () => {
    const { root, before, after } = repository();
    const git = gitIn(root);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'rm', '-q', PLAN_FILE]);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'drop plan']);
    const dropped = git(['rev-parse', 'HEAD']).trim();
    fs.mkdirSync(path.join(root, '.github', 'verify'), { recursive: true });
    git(['checkout', '-q', after, '--', PLAN_FILE]);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'restore plan']);
    const restored = git(['rev-parse', 'HEAD']).trim();

    const planned = await plan({ EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: dropped, AFTER: restored }, root);

    expect(planned.result.targets).toEqual(['common/a', 'common/b']);
    expect(planned.note).toMatch(/base plan/);
    expect(before).not.toBe(after);
  });

  const COMMITTER = ['-c', 'user.name=t', '-c', 'user.email=t@example.com'];

  /**
   * Squash-merges a pull request branched from main's HEAD, as GitHub does: the squash commit on main
   * names the pull request and has its head's tree, and `refs/pull/<n>/head` is fetchable from origin,
   * here the repository itself. `amend` changes the squash commit after the fact. Returns both commits.
   */
  function squashMerge(
    root: string,
    change: () => void,
    amend?: () => void,
  ): { head: string; squash: string; previous: string } {
    const git = gitIn(root);
    const previous = git(['rev-parse', 'HEAD']).trim();
    git(['checkout', '-q', '-b', 'pull-7']);
    change();
    git([...COMMITTER, 'add', '.']);
    git([...COMMITTER, 'commit', '-qm', 'work']);
    const head = git(['rev-parse', 'HEAD']).trim();
    git(['checkout', '-q', 'main']);
    git(['merge', '--squash', '-q', head]);
    amend?.();
    git([...COMMITTER, 'add', '.']);
    git([...COMMITTER, 'commit', '-qm', 'Change a (#7)']);
    git(['update-ref', 'refs/pull/7/head', head]);
    git(['remote', 'add', 'origin', root]);

    return { head, squash: git(['rev-parse', 'HEAD']).trim(), previous };
  }

  const changeA = (root: string) => (): void => {
    fs.writeFileSync(path.join(root, 'actions', 'common', 'a', 'more.ts'), 'export {};\n');
  };

  /** A lookup that answers with `runs` and records the commits it was asked about. */
  function lookupOf(runs: readonly CheckRun[]): {
    lookup: (sha: string) => Promise<readonly CheckRun[]>;
    asked: string[];
  } {
    const asked: string[] = [];

    return {
      asked,
      lookup: async (sha) => {
        asked.push(sha);
        return runs;
      },
    };
  }

  const SUCCESS: CheckRun = { status: 'completed', conclusion: 'success' };

  // P2: the squash commit's tree is the verified head's tree, so nothing runs again.
  it('selects nothing for a push to main that lands a verified pull request head', async () => {
    const { root } = repository();
    const { head, squash, previous } = squashMerge(root, changeA(root));
    const { lookup, asked } = lookupOf([SUCCESS]);

    const planned = await plan(
      { EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: previous, AFTER: squash },
      root,
      gitIn(root),
      lookup,
    );

    expect(planned.result).toEqual({
      targets: [],
      shards: [],
      buildDirs: [],
      e2eGroups: [],
      e2e: {},
      install: false,
      seedCache: false,
    });
    expect(planned.note).toMatch(/head of #7, which passed Verify/);
    expect(asked).toEqual([head]);
  });

  it('still seeds the dependency cache when the verified push changed the lockfile', async () => {
    const { root } = repository();
    const { squash, previous } = squashMerge(root, () => {
      changeA(root)();
      fs.writeFileSync(path.join(root, 'bun.lock'), '{}\n');
    });

    const planned = await plan(
      { EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: previous, AFTER: squash },
      root,
      gitIn(root),
      lookupOf([SUCCESS]).lookup,
    );

    expect(planned.result.targets).toEqual([]);
    expect(planned.result.seedCache).toBe(true);
  });

  it('selects as usual, with the reason, when Verify did not succeed on the head', async () => {
    const { root } = repository();
    const { squash, previous } = squashMerge(root, changeA(root));

    const planned = await plan(
      { EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: previous, AFTER: squash },
      root,
      gitIn(root),
      lookupOf([{ status: 'completed', conclusion: 'failure' }]).lookup,
    );

    expect(planned.result.targets).toEqual(['common/a']);
    expect(planned.note).toMatch(/Verify did not succeed on the head of #7/);
  });

  it('selects as usual when the pushed tree differs from the head', async () => {
    const { root } = repository();
    const { squash, previous } = squashMerge(root, changeA(root), () => {
      fs.writeFileSync(path.join(root, 'actions', 'common', 'b.txt'), 'extra\n');
    });
    const { lookup, asked } = lookupOf([SUCCESS]);

    const planned = await plan(
      { EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: previous, AFTER: squash },
      root,
      gitIn(root),
      lookup,
    );

    expect(planned.result.targets).toEqual(['common/a']);
    expect(planned.note).toMatch(/differs from the head of #7/);
    expect(asked).toEqual([]);
  });

  it('looks nothing up for a pull request, or for a push without a lookup', async () => {
    const { root, before, after } = repository();
    const { squash, previous } = squashMerge(root, changeA(root));
    const { lookup, asked } = lookupOf([SUCCESS]);

    const pullRequest = await plan(
      { EVENT_NAME: 'pull_request', BASE_REF: 'main', BASE_SHA: before, HEAD_SHA: after },
      root,
      gitIn(root),
      lookup,
    );
    const push = await plan({ EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: previous, AFTER: squash }, root);

    expect(pullRequest.result.targets).toEqual(['common/a']);
    expect(push.result.targets).toEqual(['common/a']);
    expect(push.note).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('reads the check runs with the token the step passes, and writes seed-cache', async () => {
    const { root } = repository();
    const { head, squash, previous } = squashMerge(root, () => {
      fs.writeFileSync(path.join(root, 'bun.lock'), '{}\n');
    });
    const output = path.join(root, 'output');
    const fetch = vi.fn(async () => Response.json({ check_runs: [SUCCESS] }));
    vi.stubGlobal('fetch', fetch);

    try {
      await main(
        {
          EVENT_NAME: 'push',
          REF: 'refs/heads/main',
          BEFORE: previous,
          AFTER: squash,
          CHECKS_TOKEN: 'token',
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_API_URL: 'https://api.example.test',
          GITHUB_OUTPUT: output,
        },
        root,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe(`/repos/owner/repo/commits/${head}/check-runs`);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
    expect(fs.readFileSync(output, 'utf8')).toContain('targets=[]\n');
    expect(fs.readFileSync(output, 'utf8')).toContain('seed-cache=true\n');
  });

  it('runs git without a pager', () => {
    const { root } = repository();

    expect(gitIn(root)(['rev-parse', '--is-inside-work-tree']).trim()).toBe('true');
    expect(execFileSync('git', ['--version'], { encoding: 'utf8' })).toMatch(/git version/);
  });
});
