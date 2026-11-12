import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { changedFiles, gitIn, main, plan, PLAN_FILE } from '../plan-step.js';

import type { PlanFile } from '../affected.js';

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

  it('selects the target a push changed', () => {
    const { root, before, after } = repository();

    expect(plan({ EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: before, AFTER: after }, root).result).toEqual({
      targets: ['common/a'],
      shards: ['verify-common'],
      buildDirs: ['actions/common/a'],
      install: true,
    });
  });

  it('writes the step outputs and the job summary', () => {
    const { root, before, after } = repository();
    const output = path.join(root, 'output');
    const summary = path.join(root, 'summary');

    main(
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

  it('selects the target for a changed file with a non-ASCII name', () => {
    const { root, after } = repository();
    const git = gitIn(root);
    fs.writeFileSync(path.join(root, 'actions', 'common', 'a', 'übersicht.ts'), 'export {};\n');
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '.']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'three']);
    const third = git(['rev-parse', 'HEAD']).trim();

    expect(
      plan({ EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: after, AFTER: third }, root).result.targets,
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
  it('selects the target whose jobs changed, read from the base commit plan', () => {
    const { root, after } = repository();
    const head = commitJobChange(root);

    expect(
      plan({ EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: after, AFTER: head }, root).result.targets,
    ).toEqual(['common/b']);
  });

  it('selects every target, with a note, when the base commit has no plan', () => {
    const { root, before, after } = repository();
    const git = gitIn(root);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'rm', '-q', PLAN_FILE]);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'drop plan']);
    const dropped = git(['rev-parse', 'HEAD']).trim();
    fs.mkdirSync(path.join(root, '.github', 'verify'), { recursive: true });
    git(['checkout', '-q', after, '--', PLAN_FILE]);
    git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'restore plan']);
    const restored = git(['rev-parse', 'HEAD']).trim();

    const planned = plan({ EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: dropped, AFTER: restored }, root);

    expect(planned.result.targets).toEqual(['common/a', 'common/b']);
    expect(planned.note).toMatch(/base plan/);
    expect(before).not.toBe(after);
  });

  it('runs git without a pager', () => {
    const { root } = repository();

    expect(gitIn(root)(['rev-parse', '--is-inside-work-tree']).trim()).toBe('true');
    expect(execFileSync('git', ['--version'], { encoding: 'utf8' })).toMatch(/git version/);
  });
});
