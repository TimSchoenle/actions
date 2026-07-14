import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseBranchNotFoundError, createOrResetBranch, parseRepository } from './create-branch.js';

import type { BranchApi, RepositoryCoordinates } from './create-branch.js';

const repository = 'owner/repo';
const coordinates: RepositoryCoordinates = { owner: 'owner', repo: 'repo' };

interface FakeApiOptions {
  defaultBranch?: string;
  /** Branch name to head commit, i.e. the refs that exist before the run. */
  refs?: Record<string, string>;
}

/** A fake ref store, so the tests assert on the writes the logic performs, not on the transport. */
function fakeApi({ defaultBranch = 'main', refs = { main: 'base-sha' } }: FakeApiOptions = {}): BranchApi {
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

describe('createOrResetBranch', () => {
  let api: BranchApi;

  beforeEach(() => {
    api = fakeApi({ defaultBranch: 'main', refs: { develop: 'develop-sha', main: 'base-sha' } });
  });

  it('branches off the default branch when no base branch is requested', async () => {
    const result = await createOrResetBranch(api, {
      baseBranch: '',
      branchName: 'feature',
      repository,
      resetBranch: false,
    });

    expect(result).toEqual({
      baseBranch: 'main',
      baseOrigin: 'default-branch',
      baseSha: 'base-sha',
      branch: 'feature',
      outcome: 'created',
      sha: 'base-sha',
    });
    expect(api.getDefaultBranch).toHaveBeenCalledWith(coordinates);
    expect(api.createBranch).toHaveBeenCalledWith(coordinates, 'feature', 'base-sha');
  });

  it('branches off the requested base branch without looking up the default branch', async () => {
    const result = await createOrResetBranch(api, {
      baseBranch: 'develop',
      branchName: 'feature',
      repository,
      resetBranch: false,
    });

    expect(result).toMatchObject({ baseBranch: 'develop', baseOrigin: 'input', sha: 'develop-sha' });
    expect(api.getDefaultBranch).not.toHaveBeenCalled();
    expect(api.createBranch).toHaveBeenCalledWith(coordinates, 'feature', 'develop-sha');
  });

  it('creates the branch when it does not exist yet', async () => {
    const result = await createOrResetBranch(api, {
      baseBranch: '',
      branchName: 'feature',
      repository,
      resetBranch: true,
    });

    expect(result).toMatchObject({ outcome: 'created', sha: 'base-sha' });
    expect(api.resetBranch).not.toHaveBeenCalled();
  });

  it('force-moves an existing branch back onto the base branch when reset is requested', async () => {
    const result = await createOrResetBranch(api, {
      baseBranch: '',
      branchName: 'develop',
      repository,
      resetBranch: true,
    });

    expect(result).toMatchObject({ outcome: 'reset', sha: 'base-sha' });
    expect(api.resetBranch).toHaveBeenCalledWith(coordinates, 'develop', 'base-sha');
    expect(api.createBranch).not.toHaveBeenCalled();
  });

  // Resetting discards commits, so an existing branch must survive a run that did not ask for it.
  it('leaves an existing branch untouched when reset is not requested', async () => {
    const result = await createOrResetBranch(api, {
      baseBranch: '',
      branchName: 'develop',
      repository,
      resetBranch: false,
    });

    expect(result).toMatchObject({ outcome: 'unchanged', sha: 'develop-sha' });
    expect(api.createBranch).not.toHaveBeenCalled();
    expect(api.resetBranch).not.toHaveBeenCalled();
  });

  it('fails when the base branch has no commit to branch from', async () => {
    const request = { baseBranch: 'missing', branchName: 'feature', repository, resetBranch: false };

    await expect(createOrResetBranch(api, request)).rejects.toThrow(BaseBranchNotFoundError);
    await expect(createOrResetBranch(api, request)).rejects.toThrow(
      "Could not find SHA for base branch 'missing' in repository: owner/repo",
    );
    expect(api.createBranch).not.toHaveBeenCalled();
  });

  // A repository without any commit reports a default branch whose ref does not exist.
  it('fails when the default branch has no commit either', async () => {
    const emptyRepo = fakeApi({ defaultBranch: 'main', refs: {} });

    await expect(
      createOrResetBranch(emptyRepo, { baseBranch: '', branchName: 'feature', repository, resetBranch: false }),
    ).rejects.toThrow(BaseBranchNotFoundError);
    expect(emptyRepo.createBranch).not.toHaveBeenCalled();
  });

  it('fails when the API reports an empty default branch', async () => {
    const noDefault = fakeApi({ defaultBranch: '' });

    await expect(
      createOrResetBranch(noDefault, { baseBranch: '', branchName: 'feature', repository, resetBranch: false }),
    ).rejects.toThrow('Unable to resolve a base branch for repository: owner/repo');
  });

  // Misreading a failed lookup as "the branch does not exist" would create a ref the caller believes
  // is fresh, or worse, force-move one that was never inspected.
  it('propagates API failures instead of reporting them as a missing branch', async () => {
    const failing: BranchApi = {
      ...fakeApi(),
      getBranchSha: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
    };

    await expect(
      createOrResetBranch(failing, { baseBranch: '', branchName: 'feature', repository, resetBranch: true }),
    ).rejects.toThrow('Bad credentials');
    expect(failing.createBranch).not.toHaveBeenCalled();
    expect(failing.resetBranch).not.toHaveBeenCalled();
  });

  it('rejects a malformed repository before making any API call', async () => {
    await expect(
      createOrResetBranch(api, { baseBranch: '', branchName: 'feature', repository: 'not-a-repo', resetBranch: false }),
    ).rejects.toThrow("Invalid repository 'not-a-repo'");

    expect(api.getDefaultBranch).not.toHaveBeenCalled();
    expect(api.getBranchSha).not.toHaveBeenCalled();
  });

  it('rejects an empty branch name before making any API call', async () => {
    await expect(
      createOrResetBranch(api, { baseBranch: '', branchName: '', repository, resetBranch: false }),
    ).rejects.toThrow('No branch name given. A branch to create or reset is required.');

    expect(api.getDefaultBranch).not.toHaveBeenCalled();
  });
});
