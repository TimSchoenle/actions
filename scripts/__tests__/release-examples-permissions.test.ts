import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const RELEASE_DIR = fileURLToPath(new URL('../../actions/release', import.meta.url));

interface Step {
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
}

interface Job {
  readonly permissions?: Record<string, string>;
  readonly steps?: Step[];
}

function examples(): string[] {
  return fs
    .readdirSync(RELEASE_DIR)
    .flatMap((action) => {
      const directory = path.join(RELEASE_DIR, action, 'examples');

      return fs.existsSync(directory)
        ? fs.readdirSync(directory).map((file) => path.join('actions/release', action, 'examples', file))
        : [];
    })
    .filter((file) => /\.ya?ml$/.test(file))
    .sort();
}

function runsPlanOnTheJobToken(step: Step): boolean {
  return (
    /(^\.\/|\/)actions\/release\/plan-release-please(@|$)/.test(step.uses ?? '') &&
    step.with?.['mode'] === 'plan' &&
    step.with['token'] === undefined
  );
}

describe('release action examples', () => {
  // Plan mode lists the pull requests of a commit, which the job token can do only with
  // pull-requests: read; contents: read is not enough in a private repository.
  it.each(examples())('%s grants pull-requests: read wherever plan mode runs on the job token', (file) => {
    const workflow = parse(fs.readFileSync(path.join(RELEASE_DIR, '../..', file), 'utf8')) as {
      jobs?: Record<string, Job>;
    };

    const missing = Object.entries(workflow.jobs ?? {})
      .filter(([, job]) => (job.steps ?? []).some(runsPlanOnTheJobToken))
      .filter(([, job]) => !['read', 'write'].includes(job.permissions?.['pull-requests'] ?? ''))
      .map(([name]) => name);

    expect(missing).toEqual([]);
  });

  it('finds the examples that run plan mode', () => {
    const planning = examples().filter((file) =>
      fs.readFileSync(path.join(RELEASE_DIR, '../..', file), 'utf8').includes('mode: plan'),
    );

    expect(planning).toEqual(
      expect.arrayContaining([
        'actions/release/plan-release-please/examples/release-workflow.yaml',
        'actions/release/publish-build-commit/examples/publish-job.yaml',
      ]),
    );
  });
});
