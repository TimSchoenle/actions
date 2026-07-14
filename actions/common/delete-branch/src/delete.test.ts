import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseRepository } from 'actions-common-ts-util';
import { deleteBranchIfExists } from './delete.js';

import type { BranchApi } from './delete.js';

const repository = { owner: 'owner', repo: 'repo' };

interface FakeApiOptions {
  existingBranches?: string[];
  deleteFailure?: unknown;
}

function fakeApi({ deleteFailure, existingBranches = ['main'] }: FakeApiOptions = {}): BranchApi {
  return {
    branchExists: vi.fn(async (_repository, branch: string) => existingBranches.includes(branch)),
    deleteBranch: vi.fn(async () => {
      if (deleteFailure !== undefined) {
        throw deleteFailure;
      }
    }),
  };
}

describe('parseRepository', () => {
  it('splits owner and repository name', () => {
    expect(parseRepository('TimSchoenle/actions')).toEqual({ owner: 'TimSchoenle', repo: 'actions' });
  });

  it('accepts names with dots, dashes and underscores', () => {
    expect(parseRepository('some-org/my_repo.js')).toEqual({ owner: 'some-org', repo: 'my_repo.js' });
  });

  it.each(['', 'actions', 'owner/', '/repo', 'owner/repo/extra', 'owner repo', 'https://github.com/owner/repo'])(
    'rejects the malformed repository %j',
    (value) => {
      expect(() => parseRepository(value)).toThrow(`Invalid repository '${value}'`);
    },
  );
});

describe('deleteBranchIfExists', () => {
  let api: BranchApi;

  beforeEach(() => {
    api = fakeApi({ existingBranches: ['main', 'feature/x'] });
  });

  it('deletes a branch that exists', async () => {
    const result = await deleteBranchIfExists(api, { branchName: 'feature/x', repository: 'owner/repo' });

    expect(result).toEqual({ deleted: true, outcome: 'deleted' });
    expect(api.deleteBranch).toHaveBeenCalledWith(repository, 'feature/x');
  });

  it('reports a branch that does not exist without attempting a deletion', async () => {
    const result = await deleteBranchIfExists(api, { branchName: 'gone', repository: 'owner/repo' });

    expect(result).toEqual({ deleted: false, outcome: 'not-found' });
    expect(api.branchExists).toHaveBeenCalledWith(repository, 'gone');
    expect(api.deleteBranch).not.toHaveBeenCalled();
  });

  // A protected branch, or one another job deleted first, must not fail a workflow whose actual work
  // already succeeded.
  it('reports a rejected deletion instead of throwing', async () => {
    const cause = new Error('Reference does not exist');
    const failing = fakeApi({ deleteFailure: cause, existingBranches: ['main'] });

    const result = await deleteBranchIfExists(failing, { branchName: 'main', repository: 'owner/repo' });

    expect(result).toEqual({ cause, deleted: false, outcome: 'delete-failed' });
  });

  it('wraps a non-Error deletion failure so the cause always carries a message', async () => {
    const failing = fakeApi({ deleteFailure: 'boom', existingBranches: ['main'] });

    const result = await deleteBranchIfExists(failing, { branchName: 'main', repository: 'owner/repo' });

    expect(result).toMatchObject({ deleted: false, outcome: 'delete-failed' });
    expect(result).toHaveProperty('cause.message', 'boom');
  });

  // The probe is the one place where an error could be misread as "the branch is not there", which
  // this action reports as success.
  it('propagates a failing existence probe instead of reporting a missing branch', async () => {
    const failing: BranchApi = {
      branchExists: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
      deleteBranch: vi.fn(),
    };

    await expect(deleteBranchIfExists(failing, { branchName: 'main', repository: 'owner/repo' })).rejects.toThrow(
      'Bad credentials',
    );
    expect(failing.deleteBranch).not.toHaveBeenCalled();
  });

  it('rejects a malformed repository before making any API call', async () => {
    await expect(deleteBranchIfExists(api, { branchName: 'main', repository: 'not-a-repo' })).rejects.toThrow(
      "Invalid repository 'not-a-repo'",
    );

    expect(api.branchExists).not.toHaveBeenCalled();
  });

  it('rejects an empty branch name before making any API call', async () => {
    await expect(deleteBranchIfExists(api, { branchName: '', repository: 'owner/repo' })).rejects.toThrow(
      "Invalid branch name ''",
    );

    expect(api.branchExists).not.toHaveBeenCalled();
  });
});
