import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput` / `getBooleanInput` semantics — including the YAML 1.2 core schema
 * validation that rejects a non-boolean `reject_forks` — instead of a hand-written stand-in.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  error: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  base_repo_full_name: 'owner/repo',
  branch_pattern: '^feature/.*',
  error_on_failure: 'false',
  head_ref: 'feature/test',
  head_repo_full_name: 'owner/repo',
  reject_forks: 'true',
};

/** Publishes the inputs the way the Actions runner does: as `INPUT_*` environment variables. */
function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls as [string, string][]);
}

describe('verify-branch-name action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes all three outputs on success', () => {
    run();

    expect(outputs()).toEqual({
      branch_pattern_verified: 'true',
      fork_verified: 'true',
      verified: 'true',
    });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('publishes outputs and warns when verification fails with error_on_failure=false', () => {
    setInputs({ head_ref: 'bugfix/test' });

    run();

    expect(outputs()).toEqual({
      branch_pattern_verified: 'false',
      fork_verified: 'true',
      verified: 'false',
    });
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('error_on_failure is false'));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails the step and still publishes outputs when error_on_failure=true', () => {
    setInputs({ error_on_failure: 'true', head_ref: 'bugfix/test', head_repo_full_name: 'forker/repo' });

    run();

    expect(outputs()).toEqual({
      branch_pattern_verified: 'false',
      fork_verified: 'false',
      verified: 'false',
    });
    expect(core.error).toHaveBeenCalledWith('  - Branch pattern check failed');
    expect(core.error).toHaveBeenCalledWith('  - Fork check failed');
    expect(core.setFailed).toHaveBeenCalledWith('Branch verification failed.');
  });

  it('does not fail the step when verification passes with error_on_failure=true', () => {
    setInputs({ error_on_failure: 'true' });

    run();

    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it.each(['True', 'TRUE'])('accepts %j as a boolean input', (value) => {
    setInputs({ head_repo_full_name: 'forker/repo', reject_forks: value });

    run();

    expect(outputs().fork_verified).toBe('false');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it.each([
    ['reject_forks', { reject_forks: 'yes' }],
    ['error_on_failure', { error_on_failure: '' }],
  ])('fails on a non-boolean %s value', (name, overrides) => {
    setInputs(overrides);

    run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining(`Input does not meet YAML 1.2 "Core Schema" specification: ${name}`),
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails when the repository names are empty', () => {
    setInputs({ base_repo_full_name: '', head_repo_full_name: '' });

    run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Repository names not provided'));
  });

  it('fails when a pattern is configured but no branch name can be resolved', () => {
    setInputs({ head_ref: '' });

    run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Branch name (head_ref) not provided'));
  });

  it('fails on an invalid branch pattern instead of reporting it as a mismatch', () => {
    setInputs({ branch_pattern: '^feature/(' });

    run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid branch pattern'));
  });

  it('auto-passes the pattern check when no pattern is configured', () => {
    setInputs({ branch_pattern: '', head_ref: 'anything' });

    run();

    expect(outputs()).toEqual({
      branch_pattern_verified: 'true',
      fork_verified: 'true',
      verified: 'true',
    });
  });
});
