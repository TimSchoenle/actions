import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ROOT_DIR } from '../lib/utils.js';

// release.yml builds and publishes every release. These checks pin down the properties its safety
// rests on, which no run would reveal until a release went wrong: which jobs may run repository code,
// which hold secrets, how artifacts are selected, and the order in which the jobs depend on each other.
// The docs commit is also kept in line with the pull request docs stages in update-files.yml and
// update-files-commit.yml.

interface Step {
  id?: string;
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  uses?: string;
  environment?: unknown;
  concurrency?: Record<string, unknown>;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  concurrency?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

function workflow(file: string): Workflow {
  return parse(fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', file), 'utf8')) as Workflow;
}

function stepsOf(job: Job): Step[] {
  return job.steps ?? [];
}

function stepUsing(job: Job, action: string): Step {
  const step = stepsOf(job).find((candidate) => candidate.uses?.includes(`/actions/${action}@`));

  if (step === undefined) {
    throw new Error(`No step uses ${action}.`);
  }

  return step;
}

function needsOf(job: Job): string[] {
  return job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
}

/** `owner/repo[/path]@<40 hex> # <comment>`, the only form a remote action may take here. */
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/;

const RELEASE = workflow('release.yml');
const RELEASE_TEXT = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', 'release.yml'), 'utf8');
const BOOTSTRAP = workflow('bootstrap-source-tags.yml');
const jobs = RELEASE.jobs;
const updateFiles = workflow('update-files.yml').jobs;
const updateFilesCommit = workflow('update-files-commit.yml').jobs;

/** Jobs that run this repository's code, and so must hold no secret and no write access. */
const CODE_JOBS = ['build', 'build-verify', 'generate-docs'];
/** Jobs that hold a secret or id-token: write, and so must run nothing from the repository. */
const PRIVILEGED_JOBS = ['attest', 'publish', 'release-please', 'commit-docs'];

describe('release workflow', () => {
  it('replaces release-please.yml, whose path no attestation may name', () => {
    expect(fs.existsSync(path.join(ROOT_DIR, '.github', 'workflows', 'release-please.yml'))).toBe(false);
  });

  it('runs only on pushes to main and builds only the pushed commit', () => {
    expect(Object.keys(RELEASE.on)).toEqual(['push']);
    expect(RELEASE.on.push).toEqual({ branches: ['main'] });
    expect(RELEASE_TEXT).not.toMatch(/inputs\.|workflow_dispatch|needs\.plan\.outputs\.source-sha/);
    expect(jobs.plan.if).toBe("github.ref == 'refs/heads/main'");
  });

  it('queues runs instead of cancelling them, so no release is skipped', () => {
    expect(RELEASE.concurrency).toEqual({ group: '${{ github.workflow }}-caller-${{ github.ref }}', queue: 'max' });
    expect(jobs.publish.concurrency).toEqual({ group: 'release-publish', queue: 'max' });
    expect(BOOTSTRAP.jobs.apply.concurrency).toEqual(jobs.publish.concurrency);
  });

  it('grants nothing at the workflow level', () => {
    expect(RELEASE.permissions).toEqual({});
    expect(BOOTSTRAP.permissions).toEqual({});
  });

  it('chains the release jobs in order', () => {
    expect(needsOf(jobs.build)).toEqual(['plan']);
    expect(needsOf(jobs['build-verify'])).toEqual(['plan']);
    expect(needsOf(jobs.attest)).toEqual(['plan', 'build', 'build-verify']);
    expect(needsOf(jobs.publish)).toEqual(['plan', 'build', 'build-verify', 'attest']);
    for (const id of ['build', 'build-verify', 'attest', 'publish']) {
      expect(jobs[id].if, id).toBe("needs.plan.outputs.is-release == 'true'");
    }
  });

  it('runs release-please only after the source tags are in place', () => {
    expect(needsOf(jobs['source-tags'])).toEqual(['plan', 'publish']);
    expect(jobs['source-tags'].uses).toBe('./.github/workflows/bootstrap-source-tags.yml');
    expect(jobs['source-tags'].if).toContain("needs.publish.result == 'success'");
    expect(jobs['source-tags'].if).toContain("needs.plan.outputs.release-pending != 'true'");
    expect(needsOf(jobs.preflight)).toEqual(['source-tags']);
    expect(jobs.preflight.if).toBe("${{ !cancelled() && needs.source-tags.result == 'success' }}");
    expect(stepUsing(jobs.preflight, 'release/plan-release-please').with?.mode).toBe('preflight');
    expect(needsOf(jobs['release-please'])).toEqual(['preflight']);
    expect(jobs['release-please'].if).toBe("${{ !cancelled() && needs.preflight.result == 'success' }}");
  });

  it('keeps release-please from creating tags or Releases', () => {
    const step = stepsOf(jobs['release-please']).find((candidate) => candidate.uses?.startsWith('googleapis/'));

    expect(step?.with?.['skip-github-release']).toBe(true);
  });

  it('gives release-please no GITHUB_TOKEN scope, since it authenticates with the App', () => {
    expect(jobs['release-please'].permissions).toEqual({});
  });

  it('plans and publishes with the same options', () => {
    const plan = stepUsing(jobs.plan, 'release/plan-release-please').with;
    const replan = stepUsing(jobs.publish, 'release/plan-release-please').with;
    const preflight = stepUsing(jobs.preflight, 'release/plan-release-please').with;

    expect(plan?.mode).toBe('plan');
    expect(plan?.sha).toBe('${{ github.sha }}');
    expect(replan).toEqual(plan);
    expect(plan?.['release-pr-author-id']).toBe('248313786');
    expect(preflight?.['consumer-tag-pattern']).toBe(plan?.['consumer-tag-pattern']);
  });

  it.each(CODE_JOBS)('%s runs repository code without secrets, an environment or write access', (id) => {
    const job = jobs[id];

    expect(job.environment).toBeUndefined();
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(JSON.stringify(job)).not.toMatch(/secrets\b/);
  });

  it.each([...PRIVILEGED_JOBS, 'plan', 'preflight'])('%s checks out and runs nothing from the repository', (id) => {
    for (const step of stepsOf(jobs[id])) {
      const where = `${id}: ${step.name ?? step.uses}`;
      if (step.uses !== undefined) {
        expect(step.uses, where).not.toMatch(/^\.\//);
        expect(step.uses, where).not.toMatch(/^actions\/checkout@|setup-(?:bun|node)/);
      }
      expect(step.run ?? '', where).not.toMatch(/\b(?:bun|node|npm|npx|bunx)\b|scripts\//);
    }
  });

  it.each(Object.keys(jobs))('%s uses only actions pinned by commit', (id) => {
    for (const step of stepsOf(jobs[id])) {
      if (step.uses !== undefined) {
        expect(step.uses, `${id}: ${step.name}`).toMatch(PINNED);
      }
    }
  });

  it.each(Object.keys(BOOTSTRAP.jobs))('bootstrap-source-tags %s uses only actions pinned by commit', (id) => {
    for (const step of stepsOf(BOOTSTRAP.jobs[id])) {
      if (step.uses !== undefined) {
        expect(step.uses, `${id}: ${step.name}`).toMatch(PINNED);
      }
    }
  });

  it('builds twice on separate jobs and publishes only what both agree on', () => {
    const build = stepUsing(jobs.build, 'release/build-actions').with;
    const verify = stepUsing(jobs['build-verify'], 'release/build-actions').with;
    const publish = stepUsing(jobs.publish, 'release/publish-build-commit').with;

    expect({ ...verify, 'artifact-name': undefined }).toEqual({ ...build, 'artifact-name': undefined });
    expect(verify?.['artifact-name']).not.toBe(build?.['artifact-name']);
    expect(build?.['source-sha']).toBe('${{ github.sha }}');
    expect(publish?.['source-sha']).toBe(build?.['source-sha']);
    expect(publish?.['artifact-id']).toBe('${{ needs.build.outputs.artifact-id }}');
    expect(publish?.['expected-artifact-digest']).toBe('${{ needs.build.outputs.artifact-digest }}');
    expect(publish?.['expected-manifest-sha256']).toBe('${{ needs.build.outputs.manifest-sha256 }}');
    expect(publish?.['cross-check-manifest-sha256']).toBe('${{ needs.build-verify.outputs.manifest-sha256 }}');
  });

  it('publishes only added bundles, with checksums, bundles and attestations', () => {
    const publish = stepUsing(jobs.publish, 'release/publish-build-commit').with;

    expect(publish?.['existing-files']).toBe('fail');
    expect(publish?.['release-assets']).toBe('bundles');
    expect(publish?.['releases-branch']).toBe('releases');
    expect(publish?.['make-latest']).toBe('legacy');
    expect(jobs.publish.environment).toEqual({ name: 'release', deployment: false });
    expect(jobs.publish.permissions).toEqual({ actions: 'read', contents: 'read', 'pull-requests': 'read' });
  });

  it('attests the artifact the build job verified, selected by ID', () => {
    const verify = stepUsing(jobs.attest, 'release/install-built-actions').with;
    const download = stepsOf(jobs.attest).find((step) => step.uses?.startsWith('actions/download-artifact@'));
    const attest = stepsOf(jobs.attest).find((step) => step.uses?.startsWith('actions/attest-build-provenance@'));

    expect(verify?.['artifact-id']).toBe('${{ needs.build.outputs.artifact-id }}');
    expect(verify?.['expected-manifest-sha256']).toBe('${{ needs.build.outputs.manifest-sha256 }}');
    expect(verify?.['expected-artifact-digest']).toBe('${{ needs.build.outputs.artifact-digest }}');
    expect(download?.with).toMatchObject({
      'artifact-ids': '${{ needs.build.outputs.artifact-id }}',
      'digest-mismatch': 'error',
    });
    expect(download?.with?.name).toBeUndefined();
    expect(attest?.with?.['subject-checksums']).toBe(`${download?.with?.path}/bundles.sha256`);
    expect(jobs.attest.permissions).toEqual({
      actions: 'read',
      attestations: 'write',
      contents: 'read',
      'id-token': 'write',
    });
  });
});

describe('bootstrap source tags', () => {
  const plan = BOOTSTRAP.jobs.plan;
  const apply = BOOTSTRAP.jobs.apply;

  it('can be dispatched by hand and called from release.yml', () => {
    expect(Object.keys(BOOTSTRAP.on).sort()).toEqual(['workflow_call', 'workflow_dispatch']);
  });

  it('plans from repository code with a read-only token and no secret', () => {
    expect(plan.permissions).toEqual({ contents: 'read' });
    expect(plan.environment).toBeUndefined();
    expect(JSON.stringify(plan)).not.toMatch(/secrets\b/);
    expect(plan.if).toBe("github.ref == 'refs/heads/main'");
  });

  it('applies with the release App and runs nothing from the repository', () => {
    expect(needsOf(apply)).toEqual(['plan']);
    expect(apply.permissions).toEqual({});
    expect(apply.environment).toEqual({ name: 'release', deployment: false });
    for (const step of stepsOf(apply)) {
      expect(step.uses ?? '').not.toMatch(/^actions\/checkout@|^\.\/|setup-(?:bun|node)/);
      expect(step.run ?? '').not.toMatch(/\b(?:bun|node|npm|npx|bunx)\b|scripts\//);
    }
  });

  it('re-checks every tag name and commit it is handed, and never moves a tag', () => {
    const run = stepsOf(apply).find((step) => step.name === 'Create Tags')?.run ?? '';

    expect(run).toContain('^src-[a-z0-9][a-z0-9-]*-v[0-9]+\\.[0-9]+\\.[0-9]+$');
    expect(run).toContain('^[0-9a-f]{40}$');
    expect(run).toContain('/compare/');
    expect(run).toContain('tags are never moved');
    expect(run).not.toMatch(/--method (?:PATCH|DELETE)|-X (?:PATCH|DELETE)/);
  });
});

describe('release docs commit', () => {
  const generate = jobs['generate-docs'];
  const commit = jobs['commit-docs'];

  it('generates the same files as the pull request docs stage', () => {
    expect(stepUsing(generate, 'common/create-patch').with?.paths).toBe(
      stepUsing(updateFiles['generate-docs'], 'common/create-patch').with?.paths,
    );
  });

  it('commits only the paths the pull request docs commit allows', () => {
    expect(stepUsing(commit, 'common/commit-patch').with?.allowed_paths).toBe(
      stepUsing(updateFilesCommit['update-readme'], 'common/commit-patch').with?.allowed_paths,
    );
  });

  it('runs the generator only after a push published a release', () => {
    expect(needsOf(generate)).toEqual(['plan', 'publish']);
    expect(generate.if).toBe("needs.publish.result == 'success'");
  });

  it('waits for the published tags before generating', () => {
    const names = stepsOf(generate).map((step) => step.run);
    const wait = stepsOf(generate).find((step) => step.run === 'bun run wait-release-tags');

    expect(names.indexOf('bun run wait-release-tags')).toBeLessThan(names.indexOf('bun run generate-docs'));
    expect(wait?.env?.RELEASED_PATHS).toBe('${{ needs.plan.outputs.paths }}');
    expect(jobs.plan.outputs?.paths).toBe('${{ steps.paths.outputs.paths }}');
  });

  it('generates nothing once main has moved past this run', () => {
    const steps = stepsOf(generate);
    const check = steps.findIndex((step) => step.id === 'head');
    const gated = steps.slice(check + 1);

    expect(check).toBeGreaterThan(-1);
    expect(gated.length).toBeGreaterThan(0);
    expect(gated.every((step) => step.if === "steps.head.outputs.current == 'true'")).toBe(true);
  });

  it('commits only when there is a patch, and only onto the release commit', () => {
    expect(commit.if).toBe("needs.generate-docs.outputs.has_changes == 'true'");
    expect(stepUsing(commit, 'common/commit-patch').with?.expected_head_sha).toBe('${{ github.sha }}');
    expect(stepsOf(commit).some((step) => step.run !== undefined)).toBe(false);
  });

  it('commits the patch this run generated', () => {
    const commitPatch = stepUsing(commit, 'common/commit-patch').with;

    expect(commitPatch?.artifact_name).toBe(stepUsing(generate, 'common/create-patch').with?.artifact_name);
    expect(commitPatch?.run_id).toBeUndefined();
  });
});
