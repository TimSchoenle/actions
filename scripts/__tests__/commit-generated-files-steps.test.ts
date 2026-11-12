import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ROOT_DIR } from '../lib/utils.js';

/**
 * The step order and conditions of `actions/common/commit-generated-files`. Lives here rather than
 * beside the action, so a change to it does not release the action.
 */

interface Step {
  readonly id?: string;
  readonly name: string;
  readonly if?: string;
}

const manifest = parse(
  fs.readFileSync(path.join(ROOT_DIR, 'actions/common/commit-generated-files/action.yaml'), 'utf8'),
) as { outputs: Record<string, { value: string }>; runs: { steps: Step[] } };
const steps = manifest.runs.steps;

function indexOf(id: string): number {
  const index = steps.findIndex((step) => step.id === id);
  if (index === -1) {
    throw new Error(`commit-generated-files has no step with id ${id}`);
  }

  return index;
}

const PROCEED_TO_COMMIT =
  "steps.find.outputs.has_changes == 'true' && (steps.event.outputs.fork != 'true' || steps.fork.outputs.proceed == 'true')";

describe('commit-generated-files steps', () => {
  // P14j: every fork run read the open pull requests, though most runs have nothing to commit.
  it('looks for the patch before it reads whether a fork allows edits', () => {
    expect(indexOf('find')).toBeLessThan(indexOf('fork'));
    expect(steps[indexOf('find')]?.if).toBe("steps.event.outputs.proceed == 'true'");
    expect(steps[indexOf('fork')]?.if).toBe(
      "steps.find.outputs.has_changes == 'true' && steps.event.outputs.fork == 'true'",
    );
  });

  it('fetches, mints a token and commits only for a patch it may commit', () => {
    for (const id of ['fetch', 'token', 'commit']) {
      expect(steps[indexOf(id)]?.if, id).toBe(PROCEED_TO_COMMIT);
    }
  });

  it('reports a refused fork as skipped, ahead of the patch it found', () => {
    const outcome = manifest.outputs['outcome']?.value ?? '';

    expect(outcome.indexOf('steps.fork.outputs.outcome')).toBeLessThan(outcome.indexOf('steps.find.outputs.outcome'));
  });
});
