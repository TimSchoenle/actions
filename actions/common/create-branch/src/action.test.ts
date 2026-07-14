import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { RepositoryCoordinates } from 'actions-util';
import type { BranchApi } from './create-branch.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput` / `getBooleanInput` semantics — including the YAML 1.2 core schema
 * validation that rejects a non-boolean `reset_branch` — instead of a hand-written stand-in.
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
  base_branch: '',
  branch_name: 'feature',
  repository: 'owner/repo',
  reset_branch: 'false',
  token: 'ghs_test_token',
};

/** Publishes the inputs the way the Actions runner does: as `INPUT_*` environment variables. */
function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function fakeApi(refs: Record<string, string> = { main: 'base-sha' }, defaultBranch = 'main'): BranchApi {
  const store = new Map(Object.entries(refs));

  return {
    createBranch: vi.fn(async (_repository: RepositoryCoordinates, branch: string, sha: string) => {
      store.set(branch, sha);
    }),
    getBranchSha: vi.fn(async (_repository: RepositoryCoordinates, branch: string) => store.get(branch)),
    getDefaultBranch: vi.fn(async () => defaultBranch),
    resetBranch: vi.fn(async (_repository: RepositoryCoordinates, branch: string, sha: string) => {
      store.set(branch, sha);
    }),
  };
}

describe('create-branch action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates the branch off the default branch and reports it as created', async () => {
    const api = fakeApi();

    await run(api);

    expect(api.createBranch).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 'feature', 'base-sha');
    expect(core.setOutput).toHaveBeenCalledWith('branch', 'feature');
    expect(core.setOutput).toHaveBeenCalledWith('base_branch', 'main');
    expect(core.setOutput).toHaveBeenCalledWith('sha', 'base-sha');
    expect(core.setOutput).toHaveBeenCalledWith('created', 'true');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('outputs the resolved base branch when one is given', async () => {
    setInputs({ base_branch: 'develop' });
    const api = fakeApi({ develop: 'develop-sha', main: 'base-sha' });

    await run(api);

    expect(core.setOutput).toHaveBeenCalledWith('base_branch', 'develop');
    expect(core.setOutput).toHaveBeenCalledWith('sha', 'develop-sha');
    expect(api.getDefaultBranch).not.toHaveBeenCalled();
  });

  it('resets an existing branch when reset_branch is true', async () => {
    setInputs({ reset_branch: 'true' });
    const api = fakeApi({ feature: 'stale-sha', main: 'base-sha' });

    await run(api);

    expect(api.resetBranch).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 'feature', 'base-sha');
    expect(core.setOutput).toHaveBeenCalledWith('sha', 'base-sha');
    expect(core.setOutput).toHaveBeenCalledWith('created', 'true');
  });

  it('keeps an existing branch and reports its own head when reset_branch is false', async () => {
    const api = fakeApi({ feature: 'existing-sha', main: 'base-sha' });

    await run(api);

    expect(api.createBranch).not.toHaveBeenCalled();
    expect(api.resetBranch).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('sha', 'existing-sha');
    expect(core.setOutput).toHaveBeenCalledWith('created', 'false');
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('was not reset'));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails when the base branch does not exist', async () => {
    setInputs({ base_branch: 'missing' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(
      "Could not find SHA for base branch 'missing' in repository: owner/repo",
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  // A failed lookup must never be mistaken for a branch that does not exist: the action would then
  // create — or force-move — a ref it never managed to inspect.
  it('fails on an API error instead of creating the branch', async () => {
    const api: BranchApi = {
      ...fakeApi(),
      getBranchSha: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
    };

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith('Bad credentials');
    expect(api.createBranch).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails on a malformed repository', async () => {
    setInputs({ repository: 'owner' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith("Invalid repository 'owner'. Expected the format 'owner/repo'.");
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails on a non-boolean reset_branch value', async () => {
    setInputs({ reset_branch: 'maybe' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Input does not meet YAML 1.2 "Core Schema" specification: reset_branch'),
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it.each(['token', 'repository', 'branch_name'])('fails when the required %s input is missing', async (name) => {
    setInputs({ [name]: '' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(`Input required and not supplied: ${name}`);
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});
