import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  ANCHOR_WORKFLOW_FILES,
  applyGeneratedList,
  applySummaryBlock,
  extractGeneratedList,
  isVerifyWorkflowFile,
  parseWorkflow,
  sortWorkflowNames,
  summaryJobOf,
  SUMMARY_CHECK_MATCHER,
  SUMMARY_CHECK_PREFIX,
} from '../lib/ci-required.js';
import { branchesAllow, DEFAULT_BRANCH, parseWorkflow as parseTriggers } from '../lib/required-checks.js';

// Integration-style drift guard: reads the real workflow files so that adding a
// verify workflow, renaming a job, or forgetting to regenerate the watch list
// fails CI instead of silently leaving a gap in the ci-required gate.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const CI_REQUIRED_PATH = path.join(WORKFLOWS_DIR, 'ci-required.yaml');

function readWorkflow(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- files enumerated from a fixed directory
  return fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
}

const verifyFiles = fs.readdirSync(WORKFLOWS_DIR).filter(isVerifyWorkflowFile).sort();
const ciRequired = fs.readFileSync(CI_REQUIRED_PATH, 'utf8');
const verifyNames = verifyFiles.map((file) => parseWorkflow(readWorkflow(file)).name);
const anchorNames = ANCHOR_WORKFLOW_FILES.map((file) => parseWorkflow(readWorkflow(file)).name);
const watchedNames = [...verifyNames, ...anchorNames];

describe('ci-required aggregate gate', () => {
  it('discovers the verify workflows', () => {
    expect(verifyFiles.length).toBeGreaterThan(0);
  });

  it('gates on the single CI Summary matcher', () => {
    expect(ciRequired).toContain(SUMMARY_CHECK_MATCHER);
    expect(parseWorkflow(ciRequired).jobs.some((job) => job.id === 'gate')).toBe(true);
  });

  it('watch list is in sync with the verify and anchor workflows on disk', () => {
    // Regenerate with: bun run generate-ci-required
    expect(sortWorkflowNames(extractGeneratedList(ciRequired))).toEqual(sortWorkflowNames(watchedNames));
  });

  it('watch list is byte-for-byte what the generator would emit', () => {
    // Regenerate with: bun run generate-ci-required
    expect(applyGeneratedList(ciRequired, watchedNames)).toEqual(ciRequired);
  });

  describe.each(verifyFiles)('%s', (file) => {
    const workflow = parseWorkflow(readWorkflow(file));

    it('has a Verify-prefixed workflow name', () => {
      expect(workflow.name).toMatch(/^Verify /);
    });

    it(`exposes exactly one '${SUMMARY_CHECK_PREFIX}' job`, () => {
      const summaries = workflow.jobs.filter((job) => job.name?.startsWith(SUMMARY_CHECK_PREFIX));
      expect(summaries).toHaveLength(1);
    });

    it('summary job depends on every other job so nothing is left ungated', () => {
      const summary = summaryJobOf(workflow);
      expect(summary).toBeDefined();

      const otherJobIds = workflow.jobs.filter((job) => job.id !== summary?.id).map((job) => job.id);

      expect(sortWorkflowNames(summary?.needs ?? [])).toEqual(sortWorkflowNames(otherJobIds));
    });

    it('summary block is byte-for-byte what the generator emits', () => {
      // Regenerate with: bun run generate-ci-required
      const content = readWorkflow(file);
      expect(applySummaryBlock(content)).toEqual(content);
    });
  });
});

// An anchor is what guarantees a trusted workflow_run evaluation for a pull request that starts no
// verify workflow. One that a path or branch filter can skip would leave such a pull request on
// "Expected — waiting for status to be reported" for ever.
describe.each(ANCHOR_WORKFLOW_FILES)('ci-required anchor %s', (file) => {
  const { triggers } = parseTriggers(readWorkflow(file));

  it('is not itself a verify workflow', () => {
    expect(isVerifyWorkflowFile(file)).toBe(false);
  });

  it('runs on every pull request against the default branch', () => {
    expect(triggers.onPullRequest).toBe(true);
    expect(triggers.pathFiltered).toBe(false);
    expect(triggers.branchesIgnored).toBe(false);
    expect(branchesAllow(triggers.branches, DEFAULT_BRANCH)).toBe(true);
  });
});

// A pull_request run executes the pull request's own copy of ci-required.yaml, so nothing it posted
// could be trusted, and a second publisher can land after the verdict and leave the context stuck.
// The workflow therefore runs on workflow_run alone, which always executes the default-branch copy,
// and has a single job that publishes the context.
describe('ci-required trust model', () => {
  interface Job {
    if?: string;
    steps?: { run?: string }[];
  }

  const workflow = parse(ciRequired) as { on: Record<string, unknown>; jobs: Record<string, Job> };
  const { jobs } = workflow;
  const scriptOf = (id: string): string => (jobs[id]?.steps ?? []).map((step) => step.run ?? '').join('\n');

  it('triggers on workflow_run and nothing else', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_run']);
  });

  it('publishes the context from the gate job alone', () => {
    expect(Object.keys(jobs)).toEqual(['gate']);
    expect(jobs['gate']?.if).toBe("${{ github.event_name == 'workflow_run' }}");
    expect(scriptOf('gate').split('context="ci-required"')).toHaveLength(2);
  });

  interface Step {
    name?: string;
    uses?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
    run?: string;
  }
  const steps = (jobs['gate']?.steps ?? []) as Step[];
  const stepNamed = (name: string): Step | undefined => steps.find((step) => step.name === name);

  // Line-based rather than one regex across lines: the first statement of the branch, skipping
  // blank lines and comments, has to be the pending state.
  it.each([
    ['an applicable verify workflow has no run yet', 'elif [[ "$MISSING" -gt 0 ]]; then'],
    ['a verify workflow run is unfinished', 'elif [[ "$UNFINISHED" -gt 0 ]]; then'],
  ])('keeps the gate pending while %s', (_case, condition) => {
    const lines = scriptOf('gate')
      .split('\n')
      .map((line) => line.trim());
    const branch = lines.indexOf(condition);
    const firstStatement = lines
      .slice(branch + 1)
      .find((line) => line !== '' && !line.startsWith('#') && !line.startsWith('echo '));

    expect(branch).toBeGreaterThanOrEqual(0);
    expect(firstStatement).toBe('state="pending"');
  });

  it('decides on registration before it trusts the check counts', () => {
    const script = scriptOf('gate');
    const order = [
      '"$SCOPE" == "unresolved"',
      '"$MISSING" -gt 0',
      '"$UNFINISHED" -gt 0',
      '"$EXPECTED" -gt 0 && "$matched" -eq 0',
      '"$failed" -gt 0',
      '"$SCOPE" == "pull-request" && "$APPLICABLE" -eq 0',
    ].map((condition) => script.indexOf(condition));

    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(script).toContain('description="No verify workflow applies to this change."');
  });

  // The registration script and the filters it reads decide whether the gate may report success, so
  // both come from the default branch, never from the head commit under evaluation.
  it('runs the registration barrier from the default branch', () => {
    const checkout = stepNamed('Checkout default branch');
    const registration = stepNamed('Check verify workflow registration');

    expect(checkout?.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    expect(checkout?.with).toEqual({
      ref: '${{ github.event.repository.default_branch }}',
      'persist-credentials': false,
    });
    expect(registration?.run).toBe('bun run ci-required-registration');
    expect(registration?.env?.HEAD_SHA).toBe('${{ steps.target.outputs.sha }}');
    expect(steps.indexOf(checkout as Step)).toBeLessThan(steps.indexOf(registration as Step));
  });

  it('reads every registration output it publishes from', () => {
    const publish = stepNamed('Publish ci-required status');

    for (const output of ['scope', 'applicable', 'missing', 'missing_workflows', 'unfinished', 'expected']) {
      expect(Object.values(publish?.env ?? {})).toContain(`\${{ steps.registration.outputs.${output} }}`);
    }
  });
});
