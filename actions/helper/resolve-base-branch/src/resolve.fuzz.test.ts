import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { parseRepository } from 'actions-common-ts-util';
import { BranchNotFoundError, resolveBaseBranch } from './resolve.js';

import type { BranchApi } from './resolve.js';

const segment = fc.stringMatching(/^[\w.-]{1,30}$/);
const branch = fc.stringMatching(/^[\w./-]{1,60}$/);

function fakeApi(defaultBranch: string, existingBranches: string[]): BranchApi {
  return {
    branchExists: vi.fn(async (_repository, candidate: string) => existingBranches.includes(candidate)),
    getDefaultBranch: vi.fn(async () => defaultBranch),
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

describe('resolveBaseBranch fuzzing', () => {
  it('returns the requested branch whenever it exists, and never calls the default-branch lookup', async () => {
    await fc.assert(
      fc.asyncProperty(segment, segment, branch, async (owner, repo, requested) => {
        const api = fakeApi('main', [requested]);

        const result = await resolveBaseBranch(api, {
          branchName: requested,
          checkIfExist: true,
          repository: `${owner}/${repo}`,
        });

        expect(result).toEqual({ branch: requested, exists: true, origin: 'input' });
        expect(api.getDefaultBranch).not.toHaveBeenCalled();
      }),
    );
  });

  it('never returns a branch that does not exist when the existence check is enabled', async () => {
    await fc.assert(
      fc.asyncProperty(branch, branch, fc.boolean(), async (requested, existing, useDefault) => {
        fc.pre(requested !== existing);

        const api = fakeApi(requested, [existing]);
        const request = {
          branchName: useDefault ? '' : requested,
          checkIfExist: true,
          repository: 'owner/repo',
        };

        await expect(resolveBaseBranch(api, request)).rejects.toThrow(BranchNotFoundError);
      }),
    );
  });

  it('passes any branch through unchecked when the existence check is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(branch, async (requested) => {
        const api = fakeApi('main', []);

        const result = await resolveBaseBranch(api, {
          branchName: requested,
          checkIfExist: false,
          repository: 'owner/repo',
        });

        expect(result.branch).toBe(requested);
        expect(api.branchExists).not.toHaveBeenCalled();
      }),
    );
  });
});
