import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ROOT_DIR } from '../lib/utils.js';

/**
 * Which steps of `actions/common/create-pull-request` run when. Lives here rather than beside the action,
 * so a change to it does not release the action.
 */

interface Step {
  readonly id?: string;
  readonly if?: string;
}

const steps = (
  parse(fs.readFileSync(path.join(ROOT_DIR, 'actions/common/create-pull-request/action.yaml'), 'utf8')) as {
    runs: { steps: Step[] };
  }
).runs.steps;

function step(id: string): Step {
  const found = steps.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`create-pull-request has no step with id ${id}`);
  }

  return found;
}

describe('create-pull-request steps', () => {
  // P14h: after a commit the branch differs from its base by construction, so the compare call only
  // spent a request on an answer the pull request step never needed.
  it('compares the branches only when this run committed nothing', () => {
    expect(step('diff-check').if).toBe(
      "steps.local.outputs.proceed == 'true' && steps.local.outputs.temporary == '' && steps.commit.outputs.changes_detected != 'true'",
    );
    expect(step('create-pr').if).toBe(
      "steps.diff-check.outputs.has_differences == 'true' || steps.commit.outputs.changes_detected == 'true'",
    );
  });

  // S13 step 2 and P14h: inputs and local changes are checked before anything is written, and a run
  // with nothing to commit and a reset requested mints no token and touches no branch.
  it('checks inputs and local changes before minting a token or writing a branch', () => {
    const ids = steps.map((candidate) => candidate.id);
    expect(ids.indexOf('local')).toBeLessThan(ids.indexOf('generate_token'));
    expect(step('generate_token').if).toBe("steps.local.outputs.proceed == 'true'");
    expect(step('branch').if).toBe(
      "steps.local.outputs.proceed == 'true' && (steps.local.outputs.commit != 'true' || steps.local.outputs.has_changes == 'true')",
    );
    expect(step('commit').if).toBe("steps.local.outputs.has_changes == 'true'");
  });

  // S13 step 2: a reset commits on a temporary branch, and the target moves only once that commit exists.
  it('moves the target branch only after the commit on the temporary branch', () => {
    const ids = steps.map((candidate) => candidate.id);
    expect(ids.indexOf('commit')).toBeLessThan(ids.indexOf('move'));
    expect(step('move').if).toBe(
      "steps.local.outputs.temporary != '' && steps.commit.outputs.changes_detected == 'true'",
    );
  });

  // The temporary branch is removed whether the commit or the move failed, once it may exist.
  it('always deletes the temporary branch once it may have been created', () => {
    const cleanup = steps.find(
      (candidate) => candidate.if?.includes('steps.local.outputs.temporary') && candidate.if.startsWith('always()'),
    );
    expect(cleanup?.if).toBe(
      "always() && steps.local.outputs.temporary != '' && steps.branch.outcome != 'skipped' && steps.generate_token.outcome == 'success'",
    );
  });

  // S13 step 3: the commit is pinned to the head create-branch reported.
  it('pins the commit to the head create-branch reported', () => {
    const commit = step('commit') as Step & { with?: Record<string, string> };
    expect(commit.with?.expected_head_sha).toBe('${{ steps.branch.outputs.sha }}');
  });
});
