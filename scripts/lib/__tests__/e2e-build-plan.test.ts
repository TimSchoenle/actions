import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { matchesPatternList, pullRequestFilterOf, runsForPullRequest } from '../ci-required-registration.js';
import { planE2eBuild } from '../e2e-build-plan.js';
import { extraJobsPath, findE2eActions, workflowFileName } from '../e2e-workflow.js';
import { ROOT_DIR } from '../utils.js';

function fragmentOf(actionPath: string): string {
  const [, category, name] = actionPath.split('/');
  const file = path.join(ROOT_DIR, extraJobsPath({ category, name, actionPath }));

  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function plan(actionPath: string) {
  return planE2eBuild(actionPath, fragmentOf(actionPath), `.github/workflows/x.yaml`);
}

describe('planE2eBuild against this repository', () => {
  it.each([
    // The cases run create-patch's helper through new URL('../../create-patch/helper', ...).
    ['actions/common/commit-patch', ['actions/common/commit-patch/helper', 'actions/common/create-patch/helper']],
    // The extra job runs ./actions/common/create-patch before find-patch.
    ['actions/common/find-patch', ['actions/common/create-patch/helper', 'actions/common/find-patch/helper']],
    [
      'actions/common/generated-files-verdict',
      [
        'actions/common/create-patch/helper',
        'actions/common/find-patch/helper',
        'actions/common/generated-files-verdict/helper',
      ],
    ],
    // The cases run the summary helper; the extra job runs image-check-summary itself.
    ['actions/docker/image-check', ['actions/docker/image-check-summary/helper', 'actions/docker/image-check/helper']],
    ['actions/common/read-yaml', ['actions/common/read-yaml']],
  ])('builds what %s runs', (actionPath, buildDirs) => {
    expect(plan(actionPath).buildDirs).toEqual(buildDirs);
  });

  it('installs into each extra job that runs a bundled local action, at its checkout', () => {
    expect(plan('actions/common/find-patch').installs).toEqual(new Map([['verify-composite', ['.']]]));
    expect(plan('actions/common/fetch-head').installs).toEqual(new Map([['verify-github-fetch', ['source']]]));
  });

  it('triggers on the closure, the workspace packages, the toolchain and the harness, and excludes docs', () => {
    const result = plan('actions/common/find-patch');

    expect(result.triggerIncludes).toEqual([
      '.bun-version',
      '.github/workflows/x.yaml',
      'actions/common/create-patch/**',
      'actions/common/find-patch/**',
      'bun.lock',
      'packages/action-graph/**',
      'packages/e2e/**',
      'packages/ts-util/**',
      'scripts/build-action.ts',
    ]);
    expect(result.triggerExcludes).toEqual([
      'actions/common/create-patch/CHANGELOG.md',
      'actions/common/create-patch/README.md',
      'actions/common/find-patch/CHANGELOG.md',
      'actions/common/find-patch/README.md',
    ]);
  });
});

describe('the generated verify workflows', () => {
  /** The pull_request filter of one generated workflow on disk. */
  async function filters() {
    return (await findE2eActions()).map((action) => {
      const file = `.github/workflows/${workflowFileName(action)}`;

      return { file, filter: pullRequestFilterOf(file, fs.readFileSync(path.join(ROOT_DIR, file), 'utf8')) ?? {} };
    });
  }

  function runsFor(filter: NonNullable<ReturnType<typeof pullRequestFilterOf>>, filename: string): boolean {
    return runsForPullRequest(filter, { number: 1, baseRef: 'main', files: [{ filename, status: 'modified' }] });
  }

  it('run for a pull request that only changes packages/ts-util, bun.lock or .bun-version', async () => {
    for (const { file, filter } of await filters()) {
      for (const changed of ['packages/ts-util/src/index.ts', 'bun.lock', '.bun-version']) {
        expect(runsFor(filter, changed), `${file} must run for a change to ${changed}`).toBe(true);
      }
    }
  });

  it('skip a pull request that only changes a changelog or a README', async () => {
    for (const { file, filter } of await filters()) {
      const own = (filter.paths ?? []).find((pattern) => /^actions\/[^/]+\/[^/]+\/\*\*$/.test(pattern)) ?? '';
      const action = own.slice(0, -'/**'.length);

      expect(matchesPatternList(`${action}/CHANGELOG.md`, filter.paths ?? []), file).toBe(false);
      expect(runsFor(filter, `${action}/README.md`), file).toBe(false);
    }
  });
});
