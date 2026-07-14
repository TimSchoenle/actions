import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BranchNotFoundError, parseRepository, resolveBaseBranch } from './resolve.js';

import type { BranchApi } from './resolve.js';

interface FakeApiOptions {
  defaultBranch?: string;
  existingBranches?: string[];
}

function fakeApi({ defaultBranch = 'main', existingBranches = ['main'] }: FakeApiOptions = {}): BranchApi {
  return {
    branchExists: vi.fn(async (_repository, branch: string) => existingBranches.includes(branch)),
    getDefaultBranch: vi.fn(async () => defaultBranch),
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
    (repository) => {
      expect(() => parseRepository(repository)).toThrow(`Invalid repository '${repository}'`);
    },
  );
});

describe('resolveBaseBranch', () => {
  let api: BranchApi;

  beforeEach(() => {
    api = fakeApi({ defaultBranch: 'main', existingBranches: ['main', 'develop'] });
  });

  it('resolves the default branch when no branch is requested', async () => {
    const result = await resolveBaseBranch(api, { branchName: '', checkIfExist: true, repository: 'owner/repo' });

    expect(result).toEqual({ branch: 'main', exists: true, origin: 'default-branch' });
    expect(api.getDefaultBranch).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });
  });

  it('resolves the requested branch without looking up the default branch', async () => {
    const result = await resolveBaseBranch(api, {
      branchName: 'develop',
      checkIfExist: true,
      repository: 'owner/repo',
    });

    expect(result).toEqual({ branch: 'develop', exists: true, origin: 'input' });
    expect(api.getDefaultBranch).not.toHaveBeenCalled();
    expect(api.branchExists).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 'develop');
  });

  it('throws BranchNotFoundError for a branch that does not exist', async () => {
    const request = { branchName: 'missing', checkIfExist: true, repository: 'owner/repo' };

    await expect(resolveBaseBranch(api, request)).rejects.toThrow(BranchNotFoundError);
    await expect(resolveBaseBranch(api, request)).rejects.toThrow(
      "Branch 'missing' does not exist in repository: owner/repo",
    );
  });

  it('skips the existence check when check_if_exist is false', async () => {
    const result = await resolveBaseBranch(api, {
      branchName: 'missing',
      checkIfExist: false,
      repository: 'owner/repo',
    });

    expect(result).toEqual({ branch: 'missing', exists: undefined, origin: 'input' });
    expect(api.branchExists).not.toHaveBeenCalled();
  });

  it('verifies the default branch too, catching a repository without any commit', async () => {
    const emptyRepo = fakeApi({ defaultBranch: 'main', existingBranches: [] });
    const request = { branchName: '', checkIfExist: true, repository: 'owner/empty' };

    await expect(resolveBaseBranch(emptyRepo, request)).rejects.toThrow(BranchNotFoundError);
  });

  it('propagates API failures instead of reporting them as a missing branch', async () => {
    const failing: BranchApi = {
      branchExists: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
      getDefaultBranch: vi.fn(async () => 'main'),
    };

    await expect(
      resolveBaseBranch(failing, { branchName: 'main', checkIfExist: true, repository: 'owner/repo' }),
    ).rejects.toThrow('Bad credentials');
  });

  it('rejects a malformed repository before making any API call', async () => {
    await expect(
      resolveBaseBranch(api, { branchName: '', checkIfExist: true, repository: 'not-a-repo' }),
    ).rejects.toThrow("Invalid repository 'not-a-repo'");

    expect(api.getDefaultBranch).not.toHaveBeenCalled();
  });

  it('fails when the API reports an empty default branch', async () => {
    const noDefault = fakeApi({ defaultBranch: '' });

    await expect(
      resolveBaseBranch(noDefault, { branchName: '', checkIfExist: false, repository: 'owner/repo' }),
    ).rejects.toThrow('Unable to resolve a base branch for repository: owner/repo');
  });
});
