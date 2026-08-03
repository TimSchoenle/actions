import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findDrift } from '../generate-e2e-workflows.js';
import { DECLARED_TOKEN_SCOPES, E2E_DIRECTORY, findE2eActions, workflowFileName } from '../lib/e2e-workflow.js';
import { ROOT_DIR, scanSorted } from '../lib/utils.js';

/**
 * Contract between an action, its end-to-end cases and the workflow that runs them.
 *
 * An action reaches CI only through its `verify-action-*` workflow, and those workflows are now
 * generated from the actions that have an `e2e/` directory. Two things can therefore go wrong
 * silently: an action can have no cases at all, and a generated workflow can be edited by hand and
 * then quietly rewritten. Both are checked here.
 */

/**
 * Actions with no end-to-end cases, each with the reason.
 *
 * This list may only ever shrink. A composite action cannot be driven by the harness — only the
 * runner can invoke one — so those keep hand-written workflows; anything else in this list is a gap.
 */
const E2E_EXEMPTIONS: Record<string, string> = {
  'actions/bun/setup-cached': 'composite: wraps setup-bun and actions/cache, which only the runner can run',
  'actions/common/create-pull-request': 'composite: orchestrates create-branch, commit-changes and the PR call',
  'actions/common/render-template-and-commit': 'composite: orchestrates render-template and commit-changes',
  'actions/java-gradle/auto-spotless': 'composite: checks out, sets up Java and Gradle, then commits',
  'actions/java-gradle/setup-base-environment': 'composite: sets up Java, Gradle and their caches',
  'actions/rust/auto-format': 'composite: checks out inputs.repository as its own first step',
  'actions/rust/cargo-check': 'composite: checks out inputs.repository as its own first step',
  'actions/rust/clippy': 'composite: checks out inputs.repository as its own first step',
  'actions/rust/coverage-codecov': 'composite: checks out inputs.repository, then uploads to Codecov',
  'actions/rust/test': 'composite: checks out inputs.repository as its own first step',
  'actions/test/setup-e2e': 'composite: the harness for the workflows that still need one',
};

/** Reads `runs.using` without a YAML parse, which is all the composite/node20 split needs. */
function runtimeOf(actionPath: string): string {
  const manifest = fs.readFileSync(path.join(ROOT_DIR, actionPath, 'action.yaml'), 'utf8');

  return /^\s*using:\s*'?([\w-]+)'?/m.exec(manifest)?.[1] ?? 'unknown';
}

describe('end-to-end contract', () => {
  it('gives every node20 action end-to-end cases, or a stated exemption', async () => {
    const manifests = await scanSorted('actions/*/*/action.yaml');
    const withCases = new Set((await findE2eActions()).map((action) => action.actionPath));

    const missing = manifests
      .map((manifest) => path.posix.dirname(manifest))
      .filter((actionPath) => runtimeOf(actionPath) === 'node20')
      .filter((actionPath) => !withCases.has(actionPath) && !(actionPath in E2E_EXEMPTIONS));

    expect(missing, `add ${E2E_DIRECTORY}/ cases or an entry in E2E_EXEMPTIONS with a reason`).toEqual([]);
  });

  it('exempts nothing that has cases anyway', async () => {
    const withCases = new Set((await findE2eActions()).map((action) => action.actionPath));
    const stale = Object.keys(E2E_EXEMPTIONS).filter((actionPath) => withCases.has(actionPath));

    expect(stale, 'these actions have cases now; drop them from E2E_EXEMPTIONS').toEqual([]);
  });

  it('exempts nothing that does not exist', () => {
    const gone = Object.keys(E2E_EXEMPTIONS).filter(
      (actionPath) => !fs.existsSync(path.join(ROOT_DIR, actionPath, 'action.yaml')),
    );

    expect(gone, 'these actions are gone; drop them from E2E_EXEMPTIONS').toEqual([]);
  });

  // `create-github-app-token` hands over the installation's entire permission set unless at least one
  // `permission-*` input is present, so a workflow that declares none is not "default scoped" — it is
  // maximally scoped. Nothing else in the generator makes that visible.
  it('scopes every generated token explicitly', async () => {
    for (const action of await findE2eActions()) {
      const workflow = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', workflowFileName(action)), 'utf8');

      expect(workflow, `${workflowFileName(action)} mints an unscoped token`).toMatch(/^ +permission-[\w-]+: /m);
    }
  });

  it('declares no token scopes for an action that is gone', () => {
    const gone = Object.keys(DECLARED_TOKEN_SCOPES).filter(
      (actionPath) => !fs.existsSync(path.join(ROOT_DIR, actionPath, 'action.yaml')),
    );

    expect(gone, 'these actions are gone; drop them from TOKEN_PERMISSIONS').toEqual([]);
  });

  it('keeps every generated workflow in step with its generator', async () => {
    const drift = await findDrift();

    expect(drift, "run 'bun run generate-e2e-workflows' and commit the result").toEqual([]);
  });

  it('gives every action with cases a workflow that runs them', async () => {
    const actions = await findE2eActions();

    expect(actions.length).toBeGreaterThan(0);

    for (const action of actions) {
      const workflow = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', workflowFileName(action)), 'utf8');

      expect(workflow, `${workflowFileName(action)} must run its own cases`).toContain(
        `bun run e2e ${action.actionPath}`,
      );
    }
  });
});
