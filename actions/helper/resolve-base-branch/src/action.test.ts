import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { BranchApi } from './resolve.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput` / `getBooleanInput` semantics — including the YAML 1.2 core schema
 * validation that rejects a non-boolean `check_if_exist` — instead of a hand-written stand-in.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  branch_name: '',
  check_if_exist: 'true',
  repository: 'owner/repo',
  silent_fail: 'false',
  token: 'ghs_test_token',
};

/** Publishes the inputs the way the Actions runner does: as `INPUT_*` environment variables. */
function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function fakeApi(existingBranches: string[] = ['main'], defaultBranch = 'main'): BranchApi {
  return {
    branchExists: vi.fn(async (_repository, branch: string) => existingBranches.includes(branch)),
    getDefaultBranch: vi.fn(async () => defaultBranch),
  };
}

describe('resolve-base-branch action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('outputs the default branch when no branch is requested', async () => {
    await run(fakeApi());

    expect(core.setOutput).toHaveBeenCalledWith('base_branch', 'main');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('outputs the requested branch when it exists', async () => {
    setInputs({ branch_name: 'develop' });

    await run(fakeApi(['main', 'develop']));

    expect(core.setOutput).toHaveBeenCalledWith('base_branch', 'develop');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails when the branch does not exist and silent_fail is false', async () => {
    setInputs({ branch_name: 'missing' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith("Branch 'missing' does not exist in repository: owner/repo");
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('outputs an empty branch when the branch does not exist and silent_fail is true', async () => {
    setInputs({ branch_name: 'missing', silent_fail: 'true' });

    await run(fakeApi());

    expect(core.setOutput).toHaveBeenCalledWith('base_branch', '');
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('silent_fail is true'));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('outputs a non-existing branch unchanged when the existence check is disabled', async () => {
    setInputs({ branch_name: 'missing', check_if_exist: 'false' });
    const api = fakeApi();

    await run(api);

    expect(core.setOutput).toHaveBeenCalledWith('base_branch', 'missing');
    expect(api.branchExists).not.toHaveBeenCalled();
  });

  // silent_fail exists to let a caller branch on a missing branch, not to swallow a token that
  // cannot read the repository at all — that would send the caller down a branch-creation path with
  // a token that cannot create anything.
  it('never silences an authentication failure, even with silent_fail=true', async () => {
    setInputs({ branch_name: 'main', silent_fail: 'true' });
    const api: BranchApi = {
      branchExists: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
      getDefaultBranch: vi.fn(async () => 'main'),
    };

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith('Bad credentials');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it.each([
    ['check_if_exist', { check_if_exist: 'maybe' }],
    ['silent_fail', { silent_fail: '' }],
  ])('fails on a non-boolean %s value', async (name, overrides) => {
    setInputs(overrides);

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining(`Input does not meet YAML 1.2 "Core Schema" specification: ${name}`),
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails on a malformed repository', async () => {
    setInputs({ repository: 'owner' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith("Invalid repository 'owner'. Expected the format 'owner/repo'.");
  });
});
