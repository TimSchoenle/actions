import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
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

describe('ci-required aggregate gate', () => {
  it('discovers the verify workflows', () => {
    expect(verifyFiles.length).toBeGreaterThan(0);
  });

  it('gates on the single CI Summary matcher', () => {
    expect(ciRequired).toContain(SUMMARY_CHECK_MATCHER);
    expect(parseWorkflow(ciRequired).jobs.some((job) => job.id === 'gate')).toBe(true);
  });

  it('watch list is in sync with the verify workflows on disk', () => {
    // Regenerate with: bun run generate-ci-required
    expect(sortWorkflowNames(extractGeneratedList(ciRequired))).toEqual(sortWorkflowNames(verifyNames));
  });

  it('watch list is byte-for-byte what the generator would emit', () => {
    // Regenerate with: bun run generate-ci-required
    expect(applyGeneratedList(ciRequired, verifyNames)).toEqual(ciRequired);
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
