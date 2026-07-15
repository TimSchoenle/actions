import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCommitApi, toCommitMessage } from './github-api.js';

import type { CreateCommitRequest } from './github-api.js';

vi.mock('@actions/github');

interface OctokitMock {
  graphql: ReturnType<typeof vi.fn>;
  rest: { git: { getRef: ReturnType<typeof vi.fn> } };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    graphql: vi.fn(),
    rest: { git: { getRef: vi.fn() } },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

const request: CreateCommitRequest = {
  branch: 'main',
  coordinates: { owner: 'owner', repo: 'repo' },
  expectedHeadOid: 'abc123',
  fileChanges: { additions: [{ contents: 'aGk=', path: 'a.ts' }], deletions: [{ path: 'gone.ts' }] },
  message: 'chore: update',
};

/** Reads the `input` variable passed to the last `graphql` call. */
function lastInput(octokit: OctokitMock): Record<string, unknown> {
  const variables = octokit.graphql.mock.calls.at(-1)?.[1] as { input: Record<string, unknown> };
  return variables.input;
}

describe('toCommitMessage', () => {
  it('uses a single-line message as the headline, with no body', () => {
    expect(toCommitMessage('chore: update')).toEqual({ headline: 'chore: update' });
  });

  it('splits headline and body on the first newline, dropping the blank separator line', () => {
    expect(toCommitMessage('feat: thing\n\nDetails here.')).toEqual({
      body: 'Details here.',
      headline: 'feat: thing',
    });
  });

  it('keeps a body that directly follows the headline', () => {
    expect(toCommitMessage('line1\nline2')).toEqual({ body: 'line2', headline: 'line1' });
  });
});

describe('createCommitApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  describe('getHeadOid', () => {
    it('resolves the branch head via the single-ref endpoint', async () => {
      octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'headsha' } } });

      await expect(createCommitApi('token').getHeadOid({ owner: 'o', repo: 'r' }, 'main')).resolves.toBe('headsha');
      expect(octokit.rest.git.getRef).toHaveBeenCalledWith({ owner: 'o', ref: 'heads/main', repo: 'r' });
    });
  });

  describe('createCommit', () => {
    beforeEach(() => {
      octokit.graphql.mockResolvedValue({
        createCommitOnBranch: { commit: { oid: 'newsha', url: 'https://example/commit/newsha' } },
      });
    });

    it('sends the branch, message and expected head, and returns the created commit', async () => {
      await expect(createCommitApi('token').createCommit(request)).resolves.toEqual({
        oid: 'newsha',
        url: 'https://example/commit/newsha',
      });

      expect(lastInput(octokit)).toMatchObject({
        branch: { branchName: 'main', repositoryNameWithOwner: 'owner/repo' },
        expectedHeadOid: 'abc123',
        fileChanges: request.fileChanges,
        message: { headline: 'chore: update' },
      });
    });

    it('omits fileChanges for an empty commit so GitHub does not reject it', async () => {
      await createCommitApi('token').createCommit({
        ...request,
        fileChanges: { additions: [], deletions: [] },
      });

      expect(lastInput(octokit)).not.toHaveProperty('fileChanges');
    });

    it('includes fileChanges when only deletions are present', async () => {
      await createCommitApi('token').createCommit({
        ...request,
        fileChanges: { additions: [], deletions: [{ path: 'gone.ts' }] },
      });

      expect(lastInput(octokit).fileChanges).toEqual({ additions: [], deletions: [{ path: 'gone.ts' }] });
    });

    it('fails loudly when GitHub returns no commit', async () => {
      octokit.graphql.mockResolvedValue({ createCommitOnBranch: null });

      await expect(createCommitApi('token').createCommit(request)).rejects.toThrow('did not return the created commit');
    });
  });
});
