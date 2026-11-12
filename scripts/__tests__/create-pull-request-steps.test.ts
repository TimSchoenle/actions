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
    expect(step('diff-check').if).toBe("steps.commit.outputs.changes_detected != 'true'");
    expect(step('create-pr').if).toBe(
      "steps.diff-check.outputs.has_differences == 'true' || steps.commit.outputs.changes_detected == 'true'",
    );
  });
});
