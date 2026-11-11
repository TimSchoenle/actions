import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { VERIFY_WORKFLOW_TEMPLATE, verifyWorkflowReplacements } from '../lib/action-utils.js';
import { PINNED } from '../lib/verify/pins.js';
import { ROOT_DIR, replaceTemplateVariables } from '../lib/utils.js';

/**
 * Contract for the workflow `bun run create-action` writes.
 *
 * The template lives where no Renovate manager looks, so any action ref written into it literally
 * freezes at the version it was added with. These tests render the real template the way
 * `createVerifyWorkflow` does and check the output, not the template source, so they also catch a
 * placeholder that was renamed on one side only.
 */

interface Step {
  uses?: string;
}

interface Job {
  'timeout-minutes'?: unknown;
  steps?: Step[];
}

interface Workflow {
  jobs: Record<string, Job>;
}

/** A remote ref pinned to a full commit digest: `owner/repo[/path]@<40 hex>`. */
const PINNED_REMOTE_REF = /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-f0-9]{40}$/;

/** A template placeholder left unsubstituted. GitHub expressions (`${{ ... }}`) are not placeholders. */
const UNRESOLVED_PLACEHOLDER = /(?<!\$)\{\{\s*\w+\s*\}\}/;

function render(): string {
  const template = fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'templates', VERIFY_WORKFLOW_TEMPLATE), 'utf8');

  return replaceTemplateVariables(template, verifyWorkflowReplacements('example-pkg', 'example-sub'));
}

function allUses(workflow: Workflow): string[] {
  return Object.values(workflow.jobs).flatMap((job) =>
    (job.steps ?? []).flatMap((step) => (step.uses === undefined ? [] : [step.uses])),
  );
}

describe('verify workflow template', () => {
  const rendered = render();
  const workflow = parse(rendered) as Workflow;

  it('leaves no placeholder unsubstituted', () => {
    expect(rendered).not.toMatch(UNRESOLVED_PLACEHOLDER);
  });

  it('renders at least one remote action ref', () => {
    expect(allUses(workflow).filter((uses) => !uses.startsWith('./'))).not.toHaveLength(0);
  });

  it('pins every remote uses: to a full commit digest', () => {
    // `parse` drops the trailing `# vX.Y.Z` comment, leaving exactly the ref the runner resolves.
    const unpinned = allUses(workflow).filter((uses) => !uses.startsWith('./') && !PINNED_REMOTE_REF.test(uses));

    expect(unpinned, `unpinned refs in ${VERIFY_WORKFLOW_TEMPLATE}`).toEqual([]);
  });

  it('takes every remote ref from PINNED, so Renovate keeps it current', () => {
    const maintained = new Set(Object.values(PINNED).map((pin) => pin.split(' # ')[0]));
    const unmaintained = allUses(workflow).filter((uses) => !uses.startsWith('./') && !maintained.has(uses));

    expect(unmaintained, `refs in ${VERIFY_WORKFLOW_TEMPLATE} not sourced from PINNED`).toEqual([]);
  });

  it('keeps the version comment on every rendered pin', () => {
    for (const pin of [PINNED.hardenRunner, PINNED.checkout]) {
      expect(rendered).toContain(`uses: ${pin}`);
    }
  });

  // Only the job the template owns. The `summary` block is written by `generate-ci-required` and
  // is identical across every verify workflow, so it is that generator's concern.
  it('bounds the verify job with timeout-minutes', () => {
    const timeout = workflow.jobs['verify']?.['timeout-minutes'];

    expect(typeof timeout === 'number' && timeout > 0, 'verify job must set a positive timeout-minutes').toBe(true);
  });
});
