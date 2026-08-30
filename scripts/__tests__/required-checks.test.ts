import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  branchesAllow,
  DEFAULT_BRANCH,
  findRequiredCheckProblems,
  FORBIDDEN_REQUIRED_CHECKS,
  parseWorkflow,
  REQUIRED_CHECKS,
  type RequiredCheck,
} from '../lib/required-checks.js';
import { enforcedContexts, reconcileStatusChecks } from '../check-required-checks.js';

// Integration-style guard over branch protection. A required context that never reports wedges every
// pull request on "Expected — waiting for status to be reported"; one that reports before the work it
// claims to gate has started passes vacuously. Neither shows up in a workflow diff, so renaming a job,
// adding a path filter, or turning a job into a reusable-workflow call fails here instead of in
// production.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');

function readWorkflow(file: string): string | undefined {
  const filePath = path.join(WORKFLOWS_DIR, file);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- files named by the in-repo manifest
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
}

describe('required status checks', () => {
  it('lists at least one context', () => {
    expect(REQUIRED_CHECKS.length).toBeGreaterThan(0);
  });

  it('names each context exactly once', () => {
    const contexts = REQUIRED_CHECKS.map((check) => check.context);
    expect(contexts).toEqual([...new Set(contexts)]);
  });

  it('explains why every context is gated', () => {
    for (const check of REQUIRED_CHECKS) {
      expect(check.reason.length, `${check.context} has no reason`).toBeGreaterThan(0);
    }
  });

  describe.each(REQUIRED_CHECKS.map((check) => [check.context, check] as const))('%s', (_context, check) => {
    it('is produced unconditionally by the workflow that owns it', () => {
      const content = readWorkflow(check.workflow);
      const workflow = content === undefined ? undefined : parseWorkflow(content);
      const problems = findRequiredCheckProblems(check, workflow, content).map((problem) => problem.reason);

      expect(problems).toEqual([]);
    });
  });

  // The verify workflows are path-filtered by design, so their own checks can never be required.
  // ci-required.yaml exists to collapse them into one always-reported context; requiring anything
  // else from that workflow re-opens the hole it was built to close.
  it('gates the verify workflows through the ci-required commit status', () => {
    const ciRequired = REQUIRED_CHECKS.filter((check) => check.workflow === 'ci-required.yaml');

    expect(ciRequired).toHaveLength(1);
    expect(ciRequired[0]?.kind).toBe('status');
    expect(ciRequired[0]?.context).toBe('ci-required');
  });

  it('lists no context known to gate nothing', () => {
    const offenders = REQUIRED_CHECKS.filter((check) => Object.hasOwn(FORBIDDEN_REQUIRED_CHECKS, check.context)).map(
      (check) => `${check.context}: ${FORBIDDEN_REQUIRED_CHECKS[check.context]}`,
    );

    expect(offenders).toEqual([]);
  });

  it('requires no verify-action-* context directly', () => {
    const offenders = REQUIRED_CHECKS.filter((check) => check.workflow.startsWith('verify-action-'));

    expect(offenders).toEqual([]);
  });
});

describe('required status check rules', () => {
  const check: RequiredCheck = { context: 'Gate', workflow: 'w.yml', kind: 'job', reason: 'test' };

  function problemsFor(content: string, override: Partial<RequiredCheck> = {}): string[] {
    const merged = { ...check, ...override };
    return findRequiredCheckProblems(merged, parseWorkflow(content), content).map((problem) => problem.reason);
  }

  it('accepts a plain job on an unfiltered pull_request trigger', () => {
    expect(problemsFor('on:\n  pull_request:\njobs:\n  gate:\n    name: Gate\n    runs-on: ubuntu-latest\n')).toEqual(
      [],
    );
  });

  it('accepts a job whose id is the context when it has no name', () => {
    expect(problemsFor('on:\n  pull_request:\njobs:\n  Gate:\n    runs-on: ubuntu-latest\n')).toEqual([]);
  });

  it('rejects a reusable-workflow call, whose check name changes when it is skipped', () => {
    const problems = problemsFor('on:\n  pull_request:\njobs:\n  gate:\n    name: Gate\n    uses: ./w2.yml\n');

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('reusable-workflow call');
  });

  it('rejects a path-filtered trigger, which omits the context on unrelated pull requests', () => {
    const problems = problemsFor(
      "on:\n  pull_request:\n    paths: ['src/**']\njobs:\n  gate:\n    name: Gate\n    runs-on: ubuntu-latest\n",
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('by path');
  });

  it('rejects a branch allow-list that excludes the default branch', () => {
    const problems = problemsFor(
      "on:\n  pull_request:\n    branches: ['next']\njobs:\n  gate:\n    name: Gate\n    runs-on: ubuntu-latest\n",
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('branches');
  });

  it('rejects a workflow with no pull_request trigger at all', () => {
    const problems = problemsFor("on:\n  push:\n    branches: ['main']\njobs:\n  gate:\n    name: Gate\n");

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no 'on.pull_request' trigger");
  });

  it('rejects a context no job reports', () => {
    const problems = problemsFor('on:\n  pull_request:\njobs:\n  other:\n    name: Other\n');

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no job reporting');
  });

  it('rejects a status context the workflow never posts', () => {
    const problems = problemsFor('on:\n  pull_request:\njobs:\n  gate:\n    name: Gate\n', { kind: 'status' });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('never posts a commit status');
  });

  it('accepts a status context the workflow posts', () => {
    const content = 'on:\n  pull_request:\njobs:\n  gate:\n    steps:\n      - run: gh api -f context="Gate"\n';

    expect(problemsFor(content, { kind: 'status' })).toEqual([]);
  });

  it('reports a missing workflow without inspecting it further', () => {
    expect(findRequiredCheckProblems(check, undefined, undefined).map((problem) => problem.reason)).toEqual([
      'w.yml does not exist.',
    ]);
  });

  it('treats an absent branch allow-list as unrestricted', () => {
    expect(branchesAllow(undefined, DEFAULT_BRANCH)).toBe(true);
    expect(branchesAllow(['**'], DEFAULT_BRANCH)).toBe(true);
    expect(branchesAllow(['next'], DEFAULT_BRANCH)).toBe(false);
  });
});

describe('ruleset reconciliation', () => {
  const GITHUB_ACTIONS_APP = 15368;
  const manifest = REQUIRED_CHECKS.map((check) => check.context);

  it('reads the required contexts out of a default-branch ruleset', () => {
    const rulesets = [
      {
        rules: [
          { type: 'deletion' },
          { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Lint & Test' }] } },
        ],
      },
      {
        rules: [
          { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Action Lint' }] } },
        ],
      },
    ];

    expect(enforcedContexts(rulesets)).toEqual(['Action Lint', 'Lint & Test']);
  });

  it('keeps the integration_id a context already carried', () => {
    const current = [{ context: 'Lint & Test', integration_id: GITHUB_ACTIONS_APP }];

    const reconciled = reconcileStatusChecks(current);

    expect(reconciled.map((check) => check.context)).toEqual(manifest);
    expect(reconciled.find((check) => check.context === 'Lint & Test')).toBe(current[0]);
  });

  it('gives a new context the integration_id the existing entries agree on', () => {
    const reconciled = reconcileStatusChecks([{ context: 'Lint & Test', integration_id: GITHUB_ACTIONS_APP }]);

    for (const check of reconciled) {
      expect(check.integration_id, check.context).toBe(GITHUB_ACTIONS_APP);
    }
  });

  it('drops a context the manifest no longer lists', () => {
    const reconciled = reconcileStatusChecks([
      { context: 'Aggregate verify checks', integration_id: GITHUB_ACTIONS_APP },
      { context: 'Lint & Test', integration_id: GITHUB_ACTIONS_APP },
    ]);

    expect(reconciled.map((check) => check.context)).toEqual(manifest);
  });

  // Reusing the wrong app would silently let anyone report the context, so an ambiguous ruleset is
  // handed back to a human rather than guessed at.
  it('refuses to invent an integration_id when the ruleset uses more than one', () => {
    const current = [
      { context: 'Lint & Test', integration_id: GITHUB_ACTIONS_APP },
      { context: 'Action Lint', integration_id: 99 },
    ];

    expect(() => reconcileStatusChecks(current)).toThrow(/more than one integration_id/);
  });
});
