import * as core from '@actions/core';
import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VerifyCommitsQuery } from './generated/graphql.js';
import { run } from './verify.js';

// Mock Modules
vi.mock('@actions/core');
vi.mock('@actions/github');

// Helper type for deep partial mocking
type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

describe('Verify Commit Authors Action', () => {
  let setFailedMock: ReturnType<typeof vi.fn>;
  let setOutputMock: ReturnType<typeof vi.fn>;
  let warningMock: ReturnType<typeof vi.fn>;
  let errorMock: ReturnType<typeof vi.fn>;
  let infoMock: ReturnType<typeof vi.fn>;
  let octokitMock: { graphql: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup input mocks with default valid values
    vi.mocked(core.getInput).mockImplementation((name) => {
      switch (name) {
        case 'pr_url':
          return 'https://github.com/owner/repo/pull/1';
        case 'github_token':
          return 'ghp_test_token';
        case 'user_ids':
          return '12345, 67890';
        default:
          return '';
      }
    });

    setFailedMock = vi.mocked(core.setFailed);
    setOutputMock = vi.mocked(core.setOutput);
    warningMock = vi.mocked(core.warning);
    errorMock = vi.mocked(core.error);
    infoMock = vi.mocked(core.info);

    // Setup Octokit mock
    octokitMock = { graphql: vi.fn() };
    vi.mocked(github.getOctokit).mockReturnValue(octokitMock as unknown as ReturnType<typeof github.getOctokit>);
  });

  // Type helpers for test data
  type PullRequest = Extract<NonNullable<VerifyCommitsQuery['resource']>, { __typename?: 'PullRequest' }>;
  type CommitsNodes = NonNullable<PullRequest['commits']['nodes']>;

  const mockGraphQlResponse = (nodes: DeepPartial<CommitsNodes>, totalCount?: number) => {
    const mockResponse: DeepPartial<VerifyCommitsQuery> = {
      resource: {
        __typename: 'PullRequest',
        commits: {
          totalCount: totalCount ?? nodes.length,
          nodes,
        },
      },
    };
    octokitMock.graphql.mockResolvedValue(mockResponse);
  };

  describe('Valid Commits', () => {
    it('should verify single valid commit and output true', async () => {
      mockGraphQlResponse([
        {
          commit: {
            oid: 'abc1234',
            authors: { nodes: [{ user: { databaseId: 12345 } }] },
            signature: { isValid: true },
          },
        },
      ]);

      await run();

      expect(setFailedMock).not.toHaveBeenCalled();
      expect(setOutputMock).toHaveBeenCalledWith('verified', 'true');
      expect(setOutputMock).toHaveBeenCalledWith('invalid_commits', '');
      expect(infoMock).toHaveBeenCalledWith('All commits verified.');
    });

    it('should verify multiple valid commits from different authors', async () => {
      mockGraphQlResponse([
        {
          commit: {
            oid: 'commit1',
            authors: { nodes: [{ user: { databaseId: 12345 } }] },
            signature: { isValid: true },
          },
        },
        {
          commit: {
            oid: 'commit2',
            authors: { nodes: [{ user: { databaseId: 67890 } }] },
            signature: { isValid: true },
          },
        },
      ]);

      await run();

      expect(setFailedMock).not.toHaveBeenCalled();
      expect(setOutputMock).toHaveBeenCalledWith('verified', 'true');
    });

    it('should verify commit with multiple co-authors', async () => {
      mockGraphQlResponse([
        {
          commit: {
            oid: 'coauthored',
            authors: {
              nodes: [{ user: { databaseId: 12345 } }, { user: { databaseId: 67890 } }],
            },
            signature: { isValid: true },
          },
        },
      ]);

      await run();

      expect(setFailedMock).not.toHaveBeenCalled();
      expect(setOutputMock).toHaveBeenCalledWith('verified', 'true');
    });
  });

  describe('Invalid Authors', () => {
    it('should report invalid when author is not in allowed list', async () => {
      mockGraphQlResponse([
        {
          commit: {
            oid: 'bad1234',
            authors: { nodes: [{ user: { databaseId: 99999 } }] },
            signature: { isValid: true },
          },
        },
      ]);

      await run();

      expect(warningMock).toHaveBeenCalledWith(expect.stringContaining('Found invalid commits'));
      expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
      expect(setOutputMock).toHaveBeenCalledWith('invalid_commits', 'bad1234');
      expect(errorMock).toHaveBeenCalledWith(expect.stringContaining('Author Valid: false'));
    });

    it('should report invalid when author user is null (deleted/ghost user)', async () => {
      mockGraphQlResponse([
        {
          commit: {
            oid: 'noauth123',
            authors: { nodes: [{ user: null }] },
            signature: { isValid: true },
          },
        },
      ]);

      await run();

      expect(warningMock).toHaveBeenCalledWith(expect.stringContaining('Found invalid commits'));
      expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
    });

    it('should report invalid when authors array is empty', async () => {
      mockGraphQlResponse([
        {
          commit: {
            oid: 'emptyauthors',
            authors: { nodes: [] },
            signature: { isValid: true },
          },
        },
      ]);

      await run();

      expect(warningMock).toHaveBeenCalledWith(expect.stringContaining('Found invalid commits'));
    });

    it('should report invalid when one co-author is not in allowed list', async () => {
      mockGraphQlResponse([
        {
          commit: {
            oid: 'mixedauthors',
            authors: {
              nodes: [
                { user: { databaseId: 12345 } }, // valid
                { user: { databaseId: 99999 } }, // invalid
              ],
            },
            signature: { isValid: true },
          },
        },
      ]);

      await run();

      expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
    });
  });

  describe('Invalid Signatures', () => {
    it('should report invalid when signature is false', async () => {
      mockGraphQlResponse([
        {
          commit: {
            oid: 'nosig123',
            authors: { nodes: [{ user: { databaseId: 12345 } }] },
            signature: { isValid: false },
          },
        },
      ]);

      await run();

      expect(warningMock).toHaveBeenCalledWith(expect.stringContaining('Found invalid commits'));
      expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
      expect(errorMock).toHaveBeenCalledWith(expect.stringContaining('Signature Valid: false'));
    });

    it('should report invalid when signature is null', async () => {
      mockGraphQlResponse([
        {
          commit: {
            oid: 'nullsig',
            authors: { nodes: [{ user: { databaseId: 12345 } }] },
            signature: null,
          },
        },
      ]);

      await run();

      expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
    });
  });

  describe('Edge Cases', () => {
    it('should warn and output false when PR has more than 100 commits', async () => {
      mockGraphQlResponse([], 101);

      await run();

      expect(warningMock).toHaveBeenCalledWith(expect.stringContaining('more than 100 commits'));
      expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
    });

    it('should handle empty commits list', async () => {
      mockGraphQlResponse([]);

      await run();

      expect(setOutputMock).toHaveBeenCalledWith('verified', 'true');
    });

    it('should handle null node in commits array', async () => {
      mockGraphQlResponse([null as unknown as DeepPartial<CommitsNodes>[number]]);

      await run();

      expect(setOutputMock).toHaveBeenCalledWith('verified', 'true');
    });

    it('should report multiple invalid commits', async () => {
      mockGraphQlResponse([
        {
          commit: {
            oid: 'bad1',
            authors: { nodes: [{ user: { databaseId: 99999 } }] },
            signature: { isValid: true },
          },
        },
        {
          commit: {
            oid: 'bad2',
            authors: { nodes: [{ user: { databaseId: 12345 } }] },
            signature: { isValid: false },
          },
        },
      ]);

      await run();

      expect(setOutputMock).toHaveBeenCalledWith('invalid_commits', 'bad1\nbad2');
    });
  });

  describe('Error Handling', () => {
    it('should setFailed on API errors', async () => {
      octokitMock.graphql.mockRejectedValue(new Error('API Down'));

      await run();

      expect(setFailedMock).toHaveBeenCalledWith('API Down');
    });

    it('should setFailed when resource is not a PullRequest', async () => {
      octokitMock.graphql.mockResolvedValue({
        resource: { __typename: 'Issue' },
      });

      await run();

      expect(setFailedMock).toHaveBeenCalledWith('Could not find Pull Request data from URL');
    });

    it('should setFailed when resource is null', async () => {
      octokitMock.graphql.mockResolvedValue({ resource: null });

      await run();

      expect(setFailedMock).toHaveBeenCalledWith('Could not find Pull Request data from URL');
    });

    it('should handle non-Error thrown values', async () => {
      octokitMock.graphql.mockRejectedValue('string error');

      await run();

      expect(setFailedMock).toHaveBeenCalledWith('Unknown error occurred');
    });
  });

  describe('Input Parsing', () => {
    it('should parse comma-separated user IDs correctly', async () => {
      vi.mocked(core.getInput).mockImplementation((name) => {
        if (name === 'user_ids') return '111, 222, 333';
        if (name === 'pr_url') return 'https://github.com/o/r/pull/1';
        if (name === 'github_token') return 'token';
        return '';
      });

      mockGraphQlResponse([
        {
          commit: {
            oid: 'test',
            authors: { nodes: [{ user: { databaseId: 222 } }] },
            signature: { isValid: true },
          },
        },
      ]);

      await run();

      expect(setOutputMock).toHaveBeenCalledWith('verified', 'true');
    });

    it('should log verification info', async () => {
      mockGraphQlResponse([]);

      await run();

      expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Verifying commits for PR:'));
      expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Accepted User IDs:'));
    });
  });
});
