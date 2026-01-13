import * as core from '@actions/core';
import * as github from '@actions/github';
import fc from 'fast-check';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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

describe('Verify Commit Authors Action - Fuzz Tests', () => {
  let setFailedMock: ReturnType<typeof vi.fn>;
  let setOutputMock: ReturnType<typeof vi.fn>;
  let octokitMock: { graphql: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    setFailedMock = vi.mocked(core.setFailed);
    setOutputMock = vi.mocked(core.setOutput);

    octokitMock = { graphql: vi.fn() };
    vi.mocked(github.getOctokit).mockReturnValue(octokitMock as unknown as ReturnType<typeof github.getOctokit>);
  });

  // Arbitrary for valid GitHub PR URL
  const arbPrUrl = fc
    .webUrl({ validSchemes: ['https'] })
    .map((url) => url.replace(/^https:\/\/[^/]+/, 'https://github.com') + '/pull/1');

  // Arbitrary for comma-separated user IDs
  const arbUserIds = fc.array(fc.integer({ min: 1 }), { minLength: 1, maxLength: 10 }).map((ids) => ids.join(', '));

  // Arbitrary for a hex string (commit OID) - use string and map to hex-like
  const arbOid = fc
    .string({ minLength: 7, maxLength: 40 })
    .map((s) => s.replace(/[^a-f0-9]/gi, 'a').slice(0, 40) || 'abc1234');

  // Arbitrary for a single commit node
  const arbCommitNode = fc.record({
    commit: fc.record({
      oid: arbOid,
      authors: fc.record({
        nodes: fc.array(
          fc.record({
            user: fc.oneof(fc.constant(null), fc.record({ databaseId: fc.integer() })),
          }),
          { minLength: 0, maxLength: 5 },
        ),
      }),
      signature: fc.oneof(fc.constant(null), fc.record({ isValid: fc.boolean() })),
    }),
  });

  // Arbitrary for commit nodes array
  const arbCommitNodes = fc.array(fc.oneof(fc.constant(null), arbCommitNode), { minLength: 0, maxLength: 20 });

  test('should never throw - always either succeed or call setFailed', async () => {
    await fc.assert(
      fc.asyncProperty(arbPrUrl, fc.string(), arbUserIds, arbCommitNodes, async (prUrl, token, userIds, nodes) => {
        vi.clearAllMocks();

        vi.mocked(core.getInput).mockImplementation((name) => {
          switch (name) {
            case 'pr_url':
              return prUrl;
            case 'github_token':
              return token;
            case 'user_ids':
              return userIds;
            default:
              return '';
          }
        });

        const mockResponse: DeepPartial<VerifyCommitsQuery> = {
          resource: {
            __typename: 'PullRequest',
            commits: {
              totalCount: nodes.length,
              nodes,
            },
          },
        };
        octokitMock.graphql.mockResolvedValue(mockResponse);

        // Should not throw
        await run();

        // Either setFailed was called OR verified output was set
        const failedCalls = setFailedMock.mock.calls.length;
        const outputCalls = (setOutputMock.mock.calls as [string, string][]).filter((call) => call[0] === 'verified');

        expect(failedCalls > 0 || outputCalls.length > 0).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  test('should handle arbitrary API failures gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (errorMessage) => {
        vi.clearAllMocks();

        vi.mocked(core.getInput).mockReturnValue('valid');
        octokitMock.graphql.mockRejectedValue(new Error(errorMessage));

        await run();

        expect(setFailedMock).toHaveBeenCalledWith(errorMessage);
      }),
      { numRuns: 50 },
    );
  });

  test('should correctly validate commits when allowed IDs match', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 999999 }), async (userId) => {
        vi.clearAllMocks();

        vi.mocked(core.getInput).mockImplementation((name) => {
          if (name === 'user_ids') return String(userId);
          if (name === 'pr_url') return 'https://github.com/o/r/pull/1';
          if (name === 'github_token') return 'token';
          return '';
        });

        const mockResponse: DeepPartial<VerifyCommitsQuery> = {
          resource: {
            __typename: 'PullRequest',
            commits: {
              totalCount: 1,
              nodes: [
                {
                  commit: {
                    oid: 'abc123',
                    authors: { nodes: [{ user: { databaseId: userId } }] },
                    signature: { isValid: true },
                  },
                },
              ],
            },
          },
        };
        octokitMock.graphql.mockResolvedValue(mockResponse);

        await run();

        expect(setOutputMock).toHaveBeenCalledWith('verified', 'true');
      }),
      { numRuns: 50 },
    );
  });

  test('should reject commits when allowed IDs do not match', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 499999 }),
        fc.integer({ min: 500000, max: 999999 }),
        async (allowedId, actualId) => {
          vi.clearAllMocks();

          vi.mocked(core.getInput).mockImplementation((name) => {
            if (name === 'user_ids') return String(allowedId);
            if (name === 'pr_url') return 'https://github.com/o/r/pull/1';
            if (name === 'github_token') return 'token';
            return '';
          });

          const mockResponse: DeepPartial<VerifyCommitsQuery> = {
            resource: {
              __typename: 'PullRequest',
              commits: {
                totalCount: 1,
                nodes: [
                  {
                    commit: {
                      oid: 'abc123',
                      authors: { nodes: [{ user: { databaseId: actualId } }] },
                      signature: { isValid: true },
                    },
                  },
                ],
              },
            },
          };
          octokitMock.graphql.mockResolvedValue(mockResponse);

          await run();

          expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
        },
      ),
      { numRuns: 50 },
    );
  });

  test('should always reject unsigned commits regardless of author', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1 }), async (userId) => {
        vi.clearAllMocks();

        vi.mocked(core.getInput).mockImplementation((name) => {
          if (name === 'user_ids') return String(userId);
          if (name === 'pr_url') return 'https://github.com/o/r/pull/1';
          if (name === 'github_token') return 'token';
          return '';
        });

        const mockResponse: DeepPartial<VerifyCommitsQuery> = {
          resource: {
            __typename: 'PullRequest',
            commits: {
              totalCount: 1,
              nodes: [
                {
                  commit: {
                    oid: 'abc123',
                    authors: { nodes: [{ user: { databaseId: userId } }] },
                    signature: { isValid: false }, // Invalid signature
                  },
                },
              ],
            },
          },
        };
        octokitMock.graphql.mockResolvedValue(mockResponse);

        await run();

        expect(setOutputMock).toHaveBeenCalledWith('verified', 'false');
      }),
      { numRuns: 50 },
    );
  });
});
