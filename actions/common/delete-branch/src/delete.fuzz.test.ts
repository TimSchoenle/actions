import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { parseRepository } from 'actions-util';
import { deleteBranchIfExists } from './delete.js';

import type { BranchApi } from './delete.js';

const segment = fc.stringMatching(/^[\w.-]{1,30}$/);
const branch = fc.stringMatching(/^[\w./-]{1,60}$/);

function fakeApi(existingBranches: string[]): BranchApi {
  return {
    branchExists: vi.fn(async (_repository, candidate: string) => existingBranches.includes(candidate)),
    deleteBranch: vi.fn(),
  };
}

describe('parseRepository fuzzing', () => {
  it('round-trips any well-formed owner/repo pair', () => {
    fc.assert(
      fc.property(segment, segment, (owner, repo) => {
        expect(parseRepository(`${owner}/${repo}`)).toEqual({ owner, repo });
      }),
    );
  });

  it('rejects anything that is not exactly two slash-separated segments', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const isWellFormed = /^[^\s/]+\/[^\s/]+$/.test(value);

        if (isWellFormed) {
          expect(() => parseRepository(value)).not.toThrow();
          return;
        }

        expect(() => parseRepository(value)).toThrow(/Invalid repository/);
      }),
    );
  });
});

describe('deleteBranchIfExists fuzzing', () => {
  it('deletes exactly the requested branch whenever it exists', async () => {
    await fc.assert(
      fc.asyncProperty(segment, segment, branch, async (owner, repo, requested) => {
        const api = fakeApi([requested]);

        const result = await deleteBranchIfExists(api, { branchName: requested, repository: `${owner}/${repo}` });

        expect(result).toEqual({ deleted: true, outcome: 'deleted' });
        expect(api.deleteBranch).toHaveBeenCalledWith({ owner, repo }, requested);
      }),
    );
  });

  it('never issues a deletion for a branch that does not exist', async () => {
    await fc.assert(
      fc.asyncProperty(branch, branch, async (requested, existing) => {
        fc.pre(requested !== existing);

        const api = fakeApi([existing]);

        const result = await deleteBranchIfExists(api, { branchName: requested, repository: 'owner/repo' });

        expect(result).toEqual({ deleted: false, outcome: 'not-found' });
        expect(api.deleteBranch).not.toHaveBeenCalled();
      }),
    );
  });
});
