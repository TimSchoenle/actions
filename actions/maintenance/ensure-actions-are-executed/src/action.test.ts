import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { CheckRun, CheckRunsApi } from './checks.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput` / `getBooleanInput` semantics — including the YAML 1.2 core schema
 * validation that rejects a non-boolean `error_on_failure` — instead of a hand-written stand-in.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  endGroup: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  notice: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  startGroup: vi.fn(),
  warning: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  checks: 'build\nlint',
  error_on_failure: 'true',
  match_mode: 'auto',
  ref: 'deadbeef',
  repository: 'owner/repo',
  token: 'ghs_test_token',
};

/** Publishes the inputs the way the Actions runner does: as `INPUT_*` environment variables. */
function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function checkRun(name: string, overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    conclusion: 'success',
    detailsUrl: `https://github.com/owner/repo/runs/${name}`,
    id: 1,
    name,
    status: 'completed',
    ...overrides,
  };
}

function fakeApi(checkRuns: CheckRun[], jobs: CheckRun[] | Error = []): CheckRunsApi {
  return {
    listCheckRunsForRef: vi.fn(async () => checkRuns),
    listWorkflowRunJobs: vi.fn(async () => {
      if (jobs instanceof Error) {
        throw jobs;
      }
      return jobs;
    }),
  };
}

/** The value the action published for an output, or `undefined` when it published none. */
function output(name: string): string | undefined {
  const calls = vi.mocked(core.setOutput).mock.calls.filter((call) => call[0] === name);

  return calls.at(-1)?.[1] as string | undefined;
}

function notices(): string[] {
  return vi.mocked(core.notice).mock.calls.map(([message]) => String(message));
}

describe('ensure-actions-are-executed action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GITHUB_RUN_ID', '4242');
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes when every matched check succeeded', async () => {
    await run(fakeApi([checkRun('build'), checkRun('lint'), checkRun('unrelated')]));

    expect(output('matched_checks_count')).toBe('2');
    expect(output('failed_checks_count')).toBe('0');
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.warning).not.toHaveBeenCalled();
  });

  it('verifies only the latest attempt of a re-run check', async () => {
    const api = fakeApi([
      checkRun('build', { conclusion: 'failure', id: 1 }),
      checkRun('build', { conclusion: 'success', id: 2 }),
      checkRun('lint', { id: 3 }),
    ]);

    await run(api);

    expect(output('failed_checks_count')).toBe('0');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails the step when a matched check did not succeed and error_on_failure is true', async () => {
    await run(fakeApi([checkRun('build', { conclusion: 'failure' }), checkRun('lint')]));

    expect(output('matched_checks_count')).toBe('2');
    expect(output('failed_checks_count')).toBe('1');
    expect(core.setFailed).toHaveBeenCalledWith(
      'Verification failed because 1 check(s) did not pass and error_on_failure=true.',
    );
  });

  it('fails the step when a matched check is still running', async () => {
    await run(fakeApi([checkRun('build', { conclusion: null, status: 'in_progress' }), checkRun('lint')]));

    expect(output('failed_checks_count')).toBe('1');
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('is not completed (status=in_progress)'));
    expect(core.setFailed).toHaveBeenCalled();
  });

  it('warns instead of failing when error_on_failure is false', async () => {
    setInputs({ error_on_failure: 'false' });

    await run(fakeApi([checkRun('build', { conclusion: 'failure' }), checkRun('lint')]));

    expect(output('failed_checks_count')).toBe('1');
    expect(core.warning).toHaveBeenCalledWith(
      'Found 1 failing check(s), but continuing because error_on_failure=false.',
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('ignores a skipped check', async () => {
    await run(fakeApi([checkRun('build', { conclusion: 'skipped' }), checkRun('lint')]));

    expect(output('matched_checks_count')).toBe('2');
    expect(output('failed_checks_count')).toBe('0');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  // A check that never started produces no check run. The action verifies checks that ran; it does
  // not demand that they run.
  it('passes when a matcher selects nothing, reporting it as not started', async () => {
    await run(fakeApi([checkRun('unrelated')]));

    expect(output('matched_checks_count')).toBe('0');
    expect(output('failed_checks_count')).toBe('0');
    expect(notices()).toContain("Matcher 'build' did not match any check run. This is treated as not started.");
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('selects checks with a regex matcher in auto mode', async () => {
    setInputs({ checks: '/^build/' });

    await run(fakeApi([checkRun('build (18.x)'), checkRun('build (20.x)'), checkRun('lint')]));

    expect(output('matched_checks_count')).toBe('2');
  });

  it('accepts a comma-separated matcher list', async () => {
    setInputs({ checks: 'build, lint' });

    await run(fakeApi([checkRun('build'), checkRun('lint')]));

    expect(output('matched_checks_count')).toBe('2');
  });

  it('falls back to the workflow jobs when the ref carries no check runs', async () => {
    const api = fakeApi([], [checkRun('build', { conclusion: 'failure' }), checkRun('lint')]);

    await run(api);

    expect(api.listWorkflowRunJobs).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 4242);
    expect(output('matched_checks_count')).toBe('2');
    expect(output('failed_checks_count')).toBe('1');
    expect(core.setFailed).toHaveBeenCalled();
  });

  // Listing jobs needs actions:read, which the documented checks:read token does not have. Losing the
  // fallback must not fail the step.
  it('passes when the workflow jobs fallback is not permitted', async () => {
    await run(fakeApi([], new Error('Resource not accessible by integration')));

    expect(notices()).toContainEqual(expect.stringContaining('actions:read'));
    expect(output('matched_checks_count')).toBe('0');
    expect(output('failed_checks_count')).toBe('0');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails on an uncompilable regex matcher', async () => {
    setInputs({ checks: '/[unterminated/' });

    await run(fakeApi([checkRun('build')]));

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Invalid regex matcher '/[unterminated/'"));
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails when no matcher is configured', async () => {
    setInputs({ checks: '  ,\n , ' });

    await run(fakeApi([checkRun('build')]));

    expect(core.setFailed).toHaveBeenCalledWith("No checks configured. Provide at least one matcher in 'checks'.");
  });

  it('fails on an unsupported match_mode', async () => {
    setInputs({ match_mode: 'glob' });

    await run(fakeApi([checkRun('build')]));

    expect(core.setFailed).toHaveBeenCalledWith("Invalid match_mode 'glob'. Allowed values: auto, exact, regex.");
  });

  it('fails on a non-boolean error_on_failure value', async () => {
    setInputs({ error_on_failure: 'maybe' });

    await run(fakeApi([checkRun('build')]));

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Input does not meet YAML 1.2 "Core Schema" specification: error_on_failure'),
    );
  });

  it('fails on a malformed repository', async () => {
    setInputs({ repository: 'owner' });

    await run(fakeApi([checkRun('build')]));

    expect(core.setFailed).toHaveBeenCalledWith("Invalid repository 'owner'. Expected the format 'owner/repo'.");
  });

  it('fails on an empty ref', async () => {
    setInputs({ ref: '' });

    await run(fakeApi([checkRun('build')]));

    expect(core.setFailed).toHaveBeenCalledWith("No ref to inspect. Provide a git reference in 'ref'.");
  });

  it('fails when the token cannot read the check runs', async () => {
    const api: CheckRunsApi = {
      listCheckRunsForRef: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
      listWorkflowRunJobs: vi.fn(async () => []),
    };

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith('Bad credentials');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('skips the fallback when GITHUB_RUN_ID is absent', async () => {
    vi.stubEnv('GITHUB_RUN_ID', '');
    const api = fakeApi([], [checkRun('build')]);

    await run(api);

    expect(api.listWorkflowRunJobs).not.toHaveBeenCalled();
    expect(notices()).toContainEqual(expect.stringContaining('GITHUB_RUN_ID'));
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
