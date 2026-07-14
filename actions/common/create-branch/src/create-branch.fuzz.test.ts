import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { parseRepository } from 'actions-common-ts-util';
import type { RepositoryCoordinates } from 'actions-common-ts-util';
import { createOrResetBranch } from './create-branch.js';

import type { BranchApi } from './create-branch.js';

const segment = fc.stringMatching(/^[\w.-]{1,30}$/);
const branch = fc.stringMatching(/^[\w./-]{1,60}$/);
const sha = fc.stringMatching(/^[\da-f]{40}$/);

function fakeApi(defaultBranch: string, refs: Record<string, string>): BranchApi {
  const store = new Map(Object.entries(refs));

  return {
    createBranch: vi.fn(async (_repository: RepositoryCoordinates, name: string, commit: string) => {
      store.set(name, commit);
    }),
    getBranchSha: vi.fn(async (_repository: RepositoryCoordinates, name: string) => store.get(name)),
    getDefaultBranch: vi.fn(async () => defaultBranch),
    resetBranch: vi.fn(async (_repository: RepositoryCoordinates, name: string, commit: string) => {
      store.set(name, commit);
    }),
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

describe('createOrResetBranch fuzzing', () => {
  it('creates any branch that does not exist yet, always at the base commit', async () => {
    await fc.assert(
      fc.asyncProperty(branch, branch, sha, fc.boolean(), async (target, base, baseSha, resetBranch) => {
        fc.pre(target !== base);

        const api = fakeApi(base, { [base]: baseSha });

        const result = await createOrResetBranch(api, {
          baseBranch: base,
          branchName: target,
          repository: 'owner/repo',
          resetBranch,
        });

        expect(result).toMatchObject({ baseSha, outcome: 'created', sha: baseSha });
        expect(api.createBranch).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, target, baseSha);
        expect(api.resetBranch).not.toHaveBeenCalled();
      }),
    );
  });

  // The safety property of this action: without reset_branch, an existing branch is never written to.
  it('never writes to an existing branch unless a reset was requested', async () => {
    await fc.assert(
      fc.asyncProperty(branch, branch, sha, sha, async (target, base, baseSha, targetSha) => {
        fc.pre(target !== base);

        const api = fakeApi(base, { [base]: baseSha, [target]: targetSha });

        const result = await createOrResetBranch(api, {
          baseBranch: '',
          branchName: target,
          repository: 'owner/repo',
          resetBranch: false,
        });

        expect(result).toMatchObject({ baseBranch: base, outcome: 'unchanged', sha: targetSha });
        expect(api.createBranch).not.toHaveBeenCalled();
        expect(api.resetBranch).not.toHaveBeenCalled();
      }),
    );
  });

  it('force-moves an existing branch onto the base commit whenever a reset was requested', async () => {
    await fc.assert(
      fc.asyncProperty(branch, branch, sha, sha, async (target, base, baseSha, targetSha) => {
        fc.pre(target !== base);

        const api = fakeApi(base, { [base]: baseSha, [target]: targetSha });

        const result = await createOrResetBranch(api, {
          baseBranch: base,
          branchName: target,
          repository: 'owner/repo',
          resetBranch: true,
        });

        expect(result).toMatchObject({ outcome: 'reset', sha: baseSha });
        expect(api.resetBranch).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, target, baseSha);
      }),
    );
  });
});
