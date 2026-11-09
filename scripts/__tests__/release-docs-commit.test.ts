import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ROOT_DIR } from '../lib/utils.js';

// release-please.yml regenerates the docs on main after a release and commits them as the release bot.
// These checks keep that pipeline in line with the pull request one in update-files.yml and
// update-files-commit.yml, and keep the job that runs repository code away from any secret.

interface Step {
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface Job {
  needs?: string | string[];
  if?: string;
  environment?: unknown;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: Step[];
}

function jobsOf(file: string): Record<string, Job> {
  const content = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', file), 'utf8');

  return (parse(content) as { jobs: Record<string, Job> }).jobs;
}

function stepUsing(job: Job, action: string): Step {
  const step = job.steps.find((candidate) => candidate.uses?.includes(`/actions/common/${action}@`));

  if (step === undefined) {
    throw new Error(`No step uses common/${action}.`);
  }

  return step;
}

const release = jobsOf('release-please.yml');
const updateFiles = jobsOf('update-files.yml');
const updateFilesCommit = jobsOf('update-files-commit.yml');

describe('release-please docs commit', () => {
  const generate = release['generate-docs'];
  const commit = release['commit-docs'];

  it('generates the same files as the pull request docs stage', () => {
    expect(stepUsing(generate, 'create-patch').with?.paths).toBe(
      stepUsing(updateFiles['generate-docs'], 'create-patch').with?.paths,
    );
  });

  it('commits only the paths the pull request docs commit allows', () => {
    expect(stepUsing(commit, 'commit-patch').with?.allowed_paths).toBe(
      stepUsing(updateFilesCommit['update-readme'], 'commit-patch').with?.allowed_paths,
    );
  });

  it('runs the generator only after release-please created releases', () => {
    expect(release['release-please'].outputs?.releases_created).toBe('${{ steps.release.outputs.releases_created }}');
    expect(generate.if).toBe("needs.release-please.outputs.releases_created == 'true'");
  });

  it('waits for the released tags before generating', () => {
    const names = generate.steps.map((step) => step.run);
    const wait = generate.steps.find((step) => step.run === 'bun run wait-release-tags');

    expect(names.indexOf('bun run wait-release-tags')).toBeLessThan(names.indexOf('bun run generate-docs'));
    expect(wait?.env?.RELEASED_PATHS).toBe('${{ needs.release-please.outputs.paths_released }}');
  });

  it('generates nothing once main has moved past this run', () => {
    const check = generate.steps.findIndex((step) => step.id === 'head');
    const gated = generate.steps.slice(check + 1);

    expect(check).toBeGreaterThan(-1);
    expect(gated.length).toBeGreaterThan(0);
    expect(gated.every((step) => step.if === "steps.head.outputs.current == 'true'")).toBe(true);
  });

  it('runs repository code without secrets, an environment or write access', () => {
    expect(generate.environment).toBeUndefined();
    expect(generate.permissions).toEqual({ contents: 'read' });
    expect(JSON.stringify(generate)).not.toMatch(/secrets\b/);
  });

  it('commits only when there is a patch, and only onto the release commit', () => {
    expect(commit.if).toBe("needs.generate-docs.outputs.has_changes == 'true'");
    expect(stepUsing(commit, 'commit-patch').with?.expected_head_sha).toBe('${{ github.sha }}');
    expect(commit.steps.some((step) => step.run !== undefined)).toBe(false);
  });

  it('commits the patch this run generated', () => {
    const commitPatch = stepUsing(commit, 'commit-patch').with;

    expect(commitPatch?.artifact_name).toBe(stepUsing(generate, 'create-patch').with?.artifact_name);
    expect(commitPatch?.run_id).toBeUndefined();
  });
});
