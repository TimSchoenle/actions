import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// auto-format-commit.yml and update-files-commit.yml start their find-* jobs only for a failed
// upstream run, because each upstream workflow fails whenever it uploaded a non-empty patch for a
// branch of this repository. This suite pins both halves: if the upstream step that fails the run
// goes away, a successful run could carry a patch nobody commits, and the narrowed condition in the
// commit workflow would be wrong.

const WORKFLOWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows');

interface Step {
  env?: Record<string, string>;
  if?: string;
  name?: string;
  run?: string;
}

interface Job {
  if?: string;
  needs?: string | string[];
  steps?: Step[];
}

interface Workflow {
  jobs: Record<string, Job>;
}

function loadWorkflow(file: string): Workflow {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed file names below
  return parse(fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8')) as Workflow;
}

function normalise(expression: string | undefined): string {
  return (expression ?? '').replaceAll(/\s+/g, ' ').trim();
}

function findJobsCondition(file: string): [string, string][] {
  return Object.entries(loadWorkflow(file).jobs)
    .filter(([id]) => id.startsWith('find-'))
    .map(([id, job]) => [id, normalise(job.if)]);
}

describe('workflow_run commit workflows start only for a failed upstream run', () => {
  it.each(['auto-format-commit.yml', 'update-files-commit.yml'])('%s keys every find job on failure alone', (file) => {
    const jobs = findJobsCondition(file);
    expect(jobs.length).toBeGreaterThan(0);
    for (const [id, condition] of jobs) {
      expect(condition, `${file} ${id}`).toMatch(/^github\.event\.workflow_run\.conclusion == 'failure' &&/);
      expect(condition, `${file} ${id}`).not.toContain("'success'");
    }
  });

  // The default-branch guard is a string comparison. A branch literally named refs/heads/main
  // passes it, so every job that compares names also refuses a name starting with refs/.
  it.each(['auto-format-commit.yml', 'update-files-commit.yml'])(
    '%s refuses a head branch named like a full ref wherever it guards the default branch',
    (file) => {
      const guarded = Object.entries(loadWorkflow(file).jobs).filter(([, job]) =>
        normalise(job.if).includes('head_branch != github.event.repository.default_branch'),
      );
      expect(guarded.length).toBeGreaterThan(0);
      for (const [id, job] of guarded) {
        expect(normalise(job.if), `${file} ${id}`).toContain(
          "!startsWith(github.event.workflow_run.head_branch, 'refs/')",
        );
      }
    },
  );

  it('auto-format.yml fails the run while a same-repository patch is uncommitted', () => {
    const steps = Object.values(loadWorkflow('auto-format.yml').jobs).flatMap((job) => job.steps ?? []);
    const createPatch = steps.find((step) => step.name === 'Create Patch');
    const failStep = steps.find((step) => step.name === 'Fail while the patch is uncommitted');

    expect(createPatch, 'the Create Patch step').toBeDefined();
    expect(failStep, 'the step that fails the run').toBeDefined();
    const condition = normalise(failStep?.if);
    expect(condition).toContain("steps.patch.outputs.has_changes == 'true'");
    expect(condition).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    // Nothing else may narrow it: any extra clause could let a patch through on a green run.
    expect(condition.split('&&')).toHaveLength(2);
    expect(failStep?.run ?? '').toMatch(/^\s*exit 1\s*$/m);
  });

  it('update-files.yml fails the run while any stage left a patch', () => {
    const job = loadWorkflow('update-files.yml').jobs['update-readme'];

    expect(job, 'the update-readme job').toBeDefined();
    expect(normalise(job?.if)).toBe('${{ !cancelled() }}');
    expect([job?.needs].flat()).toEqual(['generate']);
    const step = (job?.steps ?? []).find(
      (candidate) => candidate.name === 'Fail Unless The Stages Left Nothing To Commit',
    );
    expect(step, 'the step that fails the run').toBeDefined();
    expect(step?.if).toBeUndefined();
    expect(step?.env?.GENERATE_RESULT).toBe('${{ needs.generate.result }}');
    expect(step?.env?.WORKFLOWS_CHANGES).toBe('${{ needs.generate.outputs.workflows_has_changes }}');
    expect(step?.env?.DOCS_CHANGES).toBe('${{ needs.generate.outputs.docs_has_changes }}');
    const script = step?.run ?? '';
    expect(script).toMatch(/if \[ "\$GENERATE_RESULT" != "success" \]; then\n(?:.*\n)*?\s*exit 1/);
    expect(script).toMatch(/if \[ "\$WORKFLOWS_CHANGES" = "true" \]; then\n(?:.*\n)*?\s*exit 1/);
    // Fails closed: an empty output, from a skipped docs stage, is not "no changes".
    expect(script).toMatch(/if \[ "\$DOCS_CHANGES" != "false" \]; then\n(?:.*\n)*?\s*exit 1/);
  });
});
