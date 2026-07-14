import { describe, expect, it } from 'vitest';

import { verifyCheckRun, verifyCheckRuns } from './verification.js';

import type { CheckRun } from './checks.js';

function checkRun(status: string, conclusion: string | null, name = 'build'): CheckRun {
  return { conclusion, detailsUrl: null, id: 1, name, status };
}

describe('verifyCheckRun', () => {
  it('accepts a completed, successful check', () => {
    const verification = verifyCheckRun(checkRun('completed', 'success'));

    expect(verification.outcome).toBe('success');
    expect(verification.reason).toBe("Check 'build' completed successfully.");
  });

  // Skipping is how `if:` conditions and path filters express "this check does not apply here".
  it('ignores a skipped check', () => {
    const verification = verifyCheckRun(checkRun('completed', 'skipped'));

    expect(verification.outcome).toBe('skipped');
    expect(verification.reason).toBe("Check 'build' was skipped and is ignored.");
  });

  it.each(['queued', 'in_progress', 'waiting', 'pending'])('fails a check still in status %o', (status) => {
    const verification = verifyCheckRun(checkRun(status, null));

    expect(verification.outcome).toBe('failed');
    expect(verification.reason).toBe(`Check 'build' started but is not completed (status=${status}).`);
  });

  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'stale'])(
    'fails a check that completed with conclusion %o',
    (conclusion) => {
      const verification = verifyCheckRun(checkRun('completed', conclusion));

      expect(verification.outcome).toBe('failed');
      expect(verification.reason).toBe(`Check 'build' started but did not succeed (conclusion=${conclusion}).`);
    },
  );

  it('fails a completed check without a conclusion', () => {
    const verification = verifyCheckRun(checkRun('completed', null));

    expect(verification.outcome).toBe('failed');
    expect(verification.reason).toBe("Check 'build' started but did not succeed (conclusion=null).");
  });
});

describe('verifyCheckRuns', () => {
  it('counts every outcome', () => {
    const summary = verifyCheckRuns([
      checkRun('completed', 'success', 'build'),
      checkRun('completed', 'skipped', 'deploy'),
      checkRun('completed', 'failure', 'lint'),
      checkRun('in_progress', null, 'test'),
    ]);

    expect(summary.succeededCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.failedCount).toBe(2);
    expect(summary.verifications).toHaveLength(4);
  });

  it('reports no failures for no checks', () => {
    expect(verifyCheckRuns([])).toEqual({
      failedCount: 0,
      skippedCount: 0,
      succeededCount: 0,
      verifications: [],
    });
  });
});
