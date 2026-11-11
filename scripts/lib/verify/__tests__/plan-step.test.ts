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
      return args[0] === 'merge-base' ? `${SHA_A}\n` : 'a.ts\nb/c.ts\n';
    };

    expect(changedFiles(git, { kind: 'merge-base', base: SHA_B, head: SHA_A })).toEqual({ changed: ['a.ts', 'b/c.ts'] });
    expect(calls).toEqual([
      ['merge-base', SHA_B, SHA_A],
      ['diff', '--name-only', '--no-renames', SHA_A, SHA_A],
    ]);
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
      global: ['.github/workflows/verify.yaml'],
      ignore: ['**/CHANGELOG.md'],
      targets: [
        {
          id: 'common/a',
          shard: 'verify-common',
          inputs: ['actions/common/a'],
          buildDirs: ['actions/common/a'],
          pullRequestBranches: null,
          pushBranches: ['feature/common/a'],
          schedule: false,
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

  it('runs git without a pager', () => {
    const { root } = repository();

    expect(gitIn(root)(['rev-parse', '--is-inside-work-tree']).trim()).toBe('true');
    expect(execFileSync('git', ['--version'], { encoding: 'utf8' })).toMatch(/git version/);
  });
});
