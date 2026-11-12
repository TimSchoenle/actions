import { describe, expect, it } from 'vitest';

import {
  formatOutputs,
  IGNORED_FILES,
  matchesGlob,
  NULL_SHA,
  parsePlanFile,
  readEvent,
  selectTargets,
} from '../affected.js';

import type { PlanEvent, PlanFile, PlannedTarget } from '../affected.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function target(id: string, inputs: string[], overrides: Partial<PlannedTarget> = {}): PlannedTarget {
  return {
    id,
    shard: `verify-${id.split('/')[0]}`,
    inputs,
    buildDirs: [],
    install: (overrides.buildDirs?.length ?? 0) > 0,
    pullRequestBranches: null,
    pushBranches: [`feature/${id}`],
    schedule: false,
    ...overrides,
  };
}

const PLAN: PlanFile = {
  global: ['.github/workflows/verify.yaml'],
  ignore: IGNORED_FILES,
  targets: [
    target(
      'common/find-patch',
      ['actions/common/create-patch', 'actions/common/find-patch', 'packages/ts-util', 'bun.lock'],
      {
        buildDirs: ['actions/common/create-patch/helper', 'actions/common/find-patch/helper'],
      },
    ),
    target('common/create-patch', ['actions/common/create-patch', 'packages/ts-util', 'bun.lock'], {
      buildDirs: ['actions/common/create-patch/helper'],
    }),
    target('bun/setup-cached', ['actions/bun/setup-cached'], { pullRequestBranches: ['main'] }),
    target('configs/renovate', ['configs/renovate', 'renovate.json'], { schedule: true, pushBranches: [] }),
  ],
};

const PR: PlanEvent = { name: 'pull_request', baseRef: 'main' };

describe('matchesGlob', () => {
  it.each([
    ['**/CHANGELOG.md', 'CHANGELOG.md', true],
    ['**/CHANGELOG.md', 'actions/common/find-patch/CHANGELOG.md', true],
    ['**/CHANGELOG.md', 'actions/common/find-patch/CHANGELOG.mdx', false],
    ['actions/*/*/README.md', 'actions/common/find-patch/README.md', true],
    ['actions/*/*/README.md', 'actions/common/find-patch/helper/README.md', false],
    ['actions/*/*/README.md', 'packages/ts-util/README.md', false],
  ])('matches %s against %s: %s', (pattern, file, expected) => {
    expect(matchesGlob(pattern, file)).toBe(expected);
  });
});

describe('selectTargets', () => {
  it('selects every target whose inputs a shared package change touches, and unions their builds', () => {
    expect(selectTargets(PLAN, PR, ['packages/ts-util/src/index.ts'])).toEqual({
      targets: ['common/create-patch', 'common/find-patch'],
      shards: ['verify-common'],
      buildDirs: ['actions/common/create-patch/helper', 'actions/common/find-patch/helper'],
      install: true,
    });
  });

  it('asks for the install job only when a selected target reads the dependency tree', () => {
    expect(selectTargets(PLAN, PR, ['actions/bun/setup-cached/action.yaml']).install).toBe(false);
    expect(selectTargets(PLAN, PR, ['actions/common/create-patch/action.yaml']).install).toBe(true);
    expect(
      selectTargets(PLAN, PR, ['actions/bun/setup-cached/action.yaml', 'actions/common/create-patch/action.yaml'])
        .install,
    ).toBe(true);
    const e2eOnly: PlanFile = {
      ...PLAN,
      targets: [target('common/read-yaml', ['actions/common/read-yaml'], { install: true })],
    };
    expect(selectTargets(e2eOnly, PR, ['actions/common/read-yaml/action.yaml']).install).toBe(true);
  });

  it('selects only the target of a single-action change', () => {
    expect(selectTargets(PLAN, PR, ['actions/common/find-patch/src/find.ts']).targets).toEqual(['common/find-patch']);
  });

  it('selects nothing for a change to READMEs and changelogs alone', () => {
    const result = selectTargets(PLAN, PR, [
      'actions/common/find-patch/README.md',
      'actions/common/create-patch/CHANGELOG.md',
    ]);

    expect(result).toEqual({ targets: [], shards: [], buildDirs: [], install: false });
  });

  it('still selects a target for a README below the action root, which the action may read', () => {
    expect(selectTargets(PLAN, PR, ['actions/common/find-patch/helper/README.md']).targets).toEqual([
      'common/find-patch',
    ]);
  });

  it('selects every target the event allows for a change to a global input', () => {
    expect(selectTargets(PLAN, PR, ['.github/workflows/verify.yaml']).targets).toEqual([
      'bun/setup-cached',
      'common/create-patch',
      'common/find-patch',
      'configs/renovate',
    ]);
  });

  it('matches inputs on whole path segments', () => {
    expect(selectTargets(PLAN, PR, ['actions/common/find-patch-extra/x']).targets).toEqual([]);
  });

  it('keeps a target restricted to pull requests against main off one against another base', () => {
    const changed = ['actions/bun/setup-cached/action.yaml'];

    expect(selectTargets(PLAN, PR, changed).targets).toEqual(['bun/setup-cached']);
    expect(selectTargets(PLAN, { name: 'pull_request', baseRef: 'release' }, changed).targets).toEqual([]);
  });

  it('runs a target on a push to main or to its own feature branch, and nowhere else', () => {
    const changed = ['actions/common/find-patch/src/find.ts'];

    expect(selectTargets(PLAN, { name: 'push', branch: 'main' }, changed).targets).toEqual(['common/find-patch']);
    expect(selectTargets(PLAN, { name: 'push', branch: 'feature/common/find-patch' }, changed).targets).toEqual([
      'common/find-patch',
    ]);
    expect(selectTargets(PLAN, { name: 'push', branch: 'feature/common/create-patch' }, changed).targets).toEqual([]);
  });

  it('runs only the scheduled targets on the schedule, whatever changed', () => {
    expect(selectTargets(PLAN, { name: 'schedule' }, 'all').targets).toEqual(['configs/renovate']);
  });

  it('runs every target on a manual dispatch', () => {
    expect(selectTargets(PLAN, { name: 'workflow_dispatch' }, 'all').targets).toHaveLength(4);
  });

  it('runs every target the branch allows when the changed files are unknown', () => {
    expect(selectTargets(PLAN, { name: 'push', branch: 'feature/common/find-patch' }, 'all').targets).toEqual([
      'common/find-patch',
    ]);
  });
});

describe('readEvent', () => {
  it('diffs a pull request from the merge base of its base and head', () => {
    expect(readEvent({ EVENT_NAME: 'pull_request', BASE_REF: 'main', BASE_SHA: SHA_A, HEAD_SHA: SHA_B })).toEqual({
      event: { name: 'pull_request', baseRef: 'main' },
      diff: { kind: 'merge-base', base: SHA_A, head: SHA_B },
    });
  });

  it('diffs a push from before to after', () => {
    expect(readEvent({ EVENT_NAME: 'push', REF: 'refs/heads/main', BEFORE: SHA_A, AFTER: SHA_B })).toEqual({
      event: { name: 'push', branch: 'main' },
      diff: { kind: 'range', from: SHA_A, to: SHA_B },
    });
  });

  it('runs everything for a push that created the branch', () => {
    expect(
      readEvent({ EVENT_NAME: 'push', REF: 'refs/heads/feature/common/x', BEFORE: NULL_SHA, AFTER: SHA_B }).diff.kind,
    ).toBe('all');
  });

  it('needs no diff for the schedule or a dispatch', () => {
    expect(readEvent({ EVENT_NAME: 'schedule' }).diff).toEqual({ kind: 'none' });
    expect(readEvent({ EVENT_NAME: 'workflow_dispatch' }).diff).toEqual({ kind: 'none' });
  });

  it('refuses a missing value, a malformed SHA, a tag push and an unknown event', () => {
    expect(() => readEvent({ EVENT_NAME: 'pull_request', BASE_REF: 'main', BASE_SHA: SHA_A })).toThrow(/HEAD_SHA/);
    expect(() =>
      readEvent({ EVENT_NAME: 'pull_request', BASE_REF: 'main', BASE_SHA: 'main', HEAD_SHA: SHA_B }),
    ).toThrow(/not a commit SHA/);
    expect(() => readEvent({ EVENT_NAME: 'push', REF: 'refs/tags/v1', BEFORE: SHA_A, AFTER: SHA_B })).toThrow(
      /not a branch/,
    );
    expect(() => readEvent({ EVENT_NAME: 'workflow_run' })).toThrow(/workflow_run/);
  });
});

describe('formatOutputs', () => {
  it('writes JSON lists and a heredoc of build directories', () => {
    expect(formatOutputs({ targets: ['a/b'], shards: ['verify-a'], buildDirs: ['x', 'y'], install: true })).toBe(
      'targets=["a/b"]\nshards=["verify-a"]\ninstall=true\nbuild=true\nbuild-dirs<<VERIFY_PLAN_EOF\nx\ny\nVERIFY_PLAN_EOF\n',
    );
  });

  it('reports no build when nothing is built', () => {
    expect(formatOutputs({ targets: [], shards: [], buildDirs: [], install: false })).toContain('build=false\n');
  });

  it('reports no install when no selected target reads the dependency tree', () => {
    expect(formatOutputs({ targets: ['a/b'], shards: ['verify-a'], buildDirs: [], install: false })).toContain(
      'install=false\n',
    );
  });
});

describe('parsePlanFile', () => {
  it('accepts a well-formed plan', () => {
    expect(parsePlanFile(JSON.stringify(PLAN)).targets).toHaveLength(4);
  });

  it('refuses a plan without targets or with a malformed entry', () => {
    expect(() => parsePlanFile(JSON.stringify({ ...PLAN, targets: [] }))).toThrow(/no targets/);
    expect(() => parsePlanFile(JSON.stringify({ ...PLAN, targets: [{ id: 'a/b' }] }))).toThrow(/malformed/);
    const { install: _install, ...withoutInstall } = target('a/b', ['a']);
    expect(() => parsePlanFile(JSON.stringify({ ...PLAN, targets: [withoutInstall] }))).toThrow(/malformed/);
    expect(() => parsePlanFile('null')).toThrow(/global and ignore/);
  });
});
