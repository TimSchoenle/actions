import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/maintenance/ensure-actions-are-executed`, replacing the `verify` job
 * of `verify-action-maintenance-ensure-actions-are-executed.yaml` together with the two fixture jobs
 * (`successful-check`, `skipped-check`) it existed to observe.
 *
 * The fixture had to change shape. The workflow manufactured its check runs as jobs of its own run
 * and matched them by name against `github.sha`, which made the cases depend on the very run that
 * hosted them: the state under test was whatever the runner happened to have produced by that point,
 * a failing check could not be staged at all, and the third matcher pointed at the still-running
 * `verify` job. Publishing check runs directly on a commit this suite owns makes each state explicit,
 * and covers two the workflow could not reach — a check that failed, and a queued check that never
 * completes.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

/** Check run names the fixture publishes, one per state the verification distinguishes. */
const SUCCEEDED = 'e2e completed success';
const SKIPPED = 'e2e completed skipped';
const FAILED = 'e2e completed failure';
const QUEUED = 'e2e queued';

describe('ensure-actions-are-executed', () => {
  const scratch = ScratchRepo.fromEnvironment('ensure-actions-are-executed');

  let ref: string;

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      // `repository` and `ref` default to workflow expressions the harness refuses to pass through,
      // so both are supplied explicitly for every case.
      inputs: { token: scratch.token, repository: scratch.repository, ref, ...inputs },
      secrets: [scratch.token],
      expect: expected,
    });
  }

  beforeAll(async () => {
    const branch = scratch.branch('checked');

    await scratch.createBranch(branch);
    ref = await scratch.commitFile(branch, `${branch}/checked.txt`, 'checked\n', 'test: fixture for check runs');

    await scratch.createCheckRun(ref, SUCCEEDED, 'completed', 'success');
    await scratch.createCheckRun(ref, SKIPPED, 'completed', 'skipped');
    await scratch.createCheckRun(ref, FAILED, 'completed', 'failure');
    await scratch.createCheckRun(ref, QUEUED, 'queued');
  });

  afterAll(() => scratch.teardown());

  it('fails the step when a matched check failed and error_on_failure is true', async () => {
    const result = await run({ checks: `${SUCCEEDED}\n/^${FAILED}$/`, error_on_failure: 'true' }, 'failure');

    expect(result.outputs).toEqual({ matched_checks_count: '2', failed_checks_count: '1' });
    expect(result.errors.join('\n')).toContain(FAILED);
  });

  it('reports the same counts without failing when error_on_failure is false', async () => {
    const result = await run({ checks: `${SUCCEEDED}\n/^${FAILED}$/`, error_on_failure: 'false' });

    expect(result.outputs).toEqual({ matched_checks_count: '2', failed_checks_count: '1' });
    expect(result.warnings.join('\n')).toContain('error_on_failure=false');
  });

  it('ignores a skipped check, which is not a failure', async () => {
    const result = await run({ checks: `${SUCCEEDED}\n/^${SKIPPED}$/`, error_on_failure: 'true' });

    expect(result.outputs).toEqual({ matched_checks_count: '2', failed_checks_count: '0' });
  });

  // Unreachable in the workflow: a job of the run hosting the action is either finished or is the
  // action itself. A check that started and never completes is exactly what this action must catch.
  it('fails a check that started but never completed', async () => {
    const result = await run({ checks: `/^${QUEUED}$/`, error_on_failure: 'true' }, 'failure');

    expect(result.outputs).toEqual({ matched_checks_count: '1', failed_checks_count: '1' });
    expect(result.errors.join('\n')).toContain('status=queued');
  });

  it('tolerates a matcher that selects nothing, which means the check never started', async () => {
    const result = await run({ checks: 'e2e never started', error_on_failure: 'true' });

    expect(result.outputs).toEqual({ matched_checks_count: '0', failed_checks_count: '0' });
  });

  it('selects every check a single regex matches', async () => {
    const result = await run({ checks: '/^e2e /', error_on_failure: 'false' });

    // All four fixtures match; the skipped one is ignored, the failed and the queued one are not.
    expect(result.outputs).toEqual({ matched_checks_count: '4', failed_checks_count: '2' });
  });
});
