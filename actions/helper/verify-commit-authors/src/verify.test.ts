import { describe, it, expect, vi, beforeEach } from 'vitest';
import { run } from './verify';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { print } from 'graphql';
import { VerifyCommitsDocument } from './generated/graphql';
import type { VerifyCommitsQuery } from './generated/graphql';

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
  let getInputMock: any;
  let setFailedMock: any;
  let setOutputMock: any;
  let infoMock: any;
  let octokitMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup input mocks
    getInputMock = vi.mocked(core.getInput).mockImplementation((name) => {
      switch (name) {
        case 'pr_url':
          return 'https://github.com/owner/repo/pull/1';
        case 'github_token':
          return 'dummy-token';
        case 'user_ids':
          return '12345, 67890'; // Default valid IDs
        default:
          return '';
      }
    });

    setFailedMock = vi.mocked(core.setFailed);
    setOutputMock = vi.mocked(core.setOutput);
    infoMock = vi.mocked(core.info);

    // Setup Octokit mock
    octokitMock = {
      graphql: vi.fn(),
    };
    (github.getOctokit as any).mockReturnValue(octokitMock);
  });

  // Extract 'nodes' type from the query result type for convenience
  // We know resource is PullRequest in our happy path
  type ExtractPullRequest<T> = T extends { __typename?: 'PullRequest' } ? T : never;
  type PullRequest = ExtractPullRequest<NonNullable<VerifyCommitsQuery['resource']>>;
  type CommitsNodes = NonNullable<NonNullable<PullRequest['commits']['nodes']>>;

  const mockGraphQlResponse = (nodes: DeepPartial<CommitsNodes>, totalCount = 1) => {
    const mockResponse: DeepPartial<VerifyCommitsQuery> = {
      resource: {
        __typename: 'PullRequest',
        commits: {
          totalCount,
          nodes,
        },
      },
    };
    octokitMock.graphql.mockResolvedValue(mockResponse);
  };

  it('should verify valid commits and output true', async () => {
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
  });

  it('should fail if author is invalid', async () => {
    mockGraphQlResponse([
      {
        commit: {
          oid: 'bad1234',
          authors: { nodes: [{ user: { databaseId: 99999 } }] }, // 99999 not in allowed list
          signature: { isValid: true },
        },
      },
    ]);

    await run();

    expect(setFailedMock).toHaveBeenCalledWith(expect.stringContaining('Found invalid commits'));
    expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
    expect(setOutputMock).toHaveBeenCalledWith('invalid_commits', 'bad1234');
  });

  it('should fail if signature is invalid', async () => {
    mockGraphQlResponse([
      {
        commit: {
          oid: 'nosig123',
          authors: { nodes: [{ user: { databaseId: 12345 } }] },
          signature: { isValid: false }, // Invalid signature
        },
      },
    ]);

    await run();

    expect(setFailedMock).toHaveBeenCalledWith(expect.stringContaining('Found invalid commits'));
    expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
  });

  it('should fail if author is missing (null)', async () => {
    mockGraphQlResponse([
      {
        commit: {
          oid: 'noauth123',
          authors: { nodes: [{ user: null }] }, // Deleted user or ghost
          signature: { isValid: true },
        },
      },
    ]);

    await run();

    expect(setFailedMock).toHaveBeenCalledWith(expect.stringContaining('Found invalid commits'));
  });

  it('should fail if too many commits (>100)', async () => {
    mockGraphQlResponse([], 101); // 101 commits

    await run();

    expect(setFailedMock).toHaveBeenCalledWith(expect.stringContaining('more than 100 commits'));
    expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
  });

  it('should handle API errors gracefully', async () => {
    octokitMock.graphql.mockRejectedValue(new Error('API Down'));

    await run();

    expect(setFailedMock).toHaveBeenCalledWith('API Down');
  });
});
