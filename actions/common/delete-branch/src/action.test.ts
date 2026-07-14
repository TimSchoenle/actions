import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { BranchApi } from './delete.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput` semantics — including the `required` enforcement, which the runner
 * itself does not perform — instead of a hand-written stand-in.
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
  branch_name: 'feature/x',
  repository: 'owner/repo',
  token: 'ghs_test_token',
};

/** Publishes the inputs the way the Actions runner does: as `INPUT_*` environment variables. */
function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function fakeApi(existingBranches: string[] = ['feature/x'], deleteFailure?: Error): BranchApi {
  return {
    branchExists: vi.fn(async (_repository, branch: string) => existingBranches.includes(branch)),
    deleteBranch: vi.fn(async () => {
      if (deleteFailure) {
        throw deleteFailure;
      }
    }),
  };
}

describe('delete-branch action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('outputs deleted=true when the branch was deleted', async () => {
    const api = fakeApi();

    await run(api);

    expect(api.deleteBranch).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 'feature/x');
    expect(core.setOutput).toHaveBeenCalledWith('deleted', 'true');
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.warning).not.toHaveBeenCalled();
  });

  it('outputs deleted=false and succeeds when the branch does not exist', async () => {
    const api = fakeApi([]);

    await run(api);

    expect(api.deleteBranch).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('deleted', 'false');
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Skipping delete'));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  // Cleanup runs after the work that mattered has already succeeded, so a branch that survives is
  // worth a warning, never a red job.
  it('warns and outputs deleted=false when the deletion is rejected', async () => {
    await run(fakeApi(['feature/x'], new Error('Reference does not exist')));

    expect(core.warning).toHaveBeenCalledWith("Failed to delete branch 'feature/x': Reference does not exist");
    expect(core.setOutput).toHaveBeenCalledWith('deleted', 'false');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  // A token that cannot read the repository must not be reported as "the branch is already gone",
  // which is the success path every caller of this action relies on.
  it('fails when the existence probe fails for any reason other than "not found"', async () => {
    const api: BranchApi = {
      branchExists: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
      deleteBranch: vi.fn(),
    };

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith('Bad credentials');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails on a malformed repository', async () => {
    setInputs({ repository: 'owner' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith("Invalid repository 'owner'. Expected the format 'owner/repo'.");
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it.each(['token', 'repository', 'branch_name'])('fails when the required input %s is missing', async (name) => {
    setInputs({ [name]: '' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(`Input required and not supplied: ${name}`);
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});
