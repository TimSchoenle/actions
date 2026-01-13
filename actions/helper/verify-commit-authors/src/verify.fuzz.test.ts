import { describe, test, vi, beforeEach, expect } from 'vitest';
import fc from 'fast-check';
import { run } from './verify';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { print } from 'graphql';
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

describe('Verify Commit Authors Action Fuzzing', () => {
  let getInputMock: any;
  let setFailedMock: any;
  let setOutputMock: any;
  let infoMock: any;
  let octokitMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    setFailedMock = vi.mocked(core.setFailed);
    setOutputMock = vi.mocked(core.setOutput);
    infoMock = vi.mocked(core.info);

    // Setup Octokit mock (default empty)
    octokitMock = {
      graphql: vi.fn(),
    };
    (github.getOctokit as any).mockReturnValue(octokitMock);
  });

  test('should handle arbitrary inputs gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(), // pr_url
        fc.string(), // token
        fc.string(), // user_ids
        fc.array(
          // commits
          fc.record({
            commit: fc.record({
              oid: fc.string(),
              authors: fc.record({
                nodes: fc.array(
                  fc.record({
                    user: fc.oneof(fc.constant(null), fc.record({ databaseId: fc.integer() })),
                  }),
                ),
              }),
              signature: fc.oneof(fc.constant(null), fc.record({ isValid: fc.boolean() })),
            }),
          }),
        ),
        async (prUrl, token, userIds, nodes: any) => {
          // Reset mocks for each run in the fuzz loop is tricky because they are shared.
          // Ideally we mock inside the property execution or assume statelessness.
          // Here `run()` relies on global `core.getInput`.

          vi.clearAllMocks(); // Clear calls from previous iteration

          getInputMock = vi.mocked(core.getInput).mockImplementation((name) => {
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

          // Mock API Response
          const mockResponse: DeepPartial<VerifyCommitsQuery> = {
            resource: {
              __typename: 'PullRequest',
              commits: {
                totalCount: nodes.length,
                nodes: nodes,
              },
            },
          };
          octokitMock.graphql.mockResolvedValue(mockResponse);

          // Exec
          await run();

          const isFailed = setFailedMock.mock.calls.length > 0;

          // If it failed, it must be because of valid reasons (too many commits, api error, invalid authors)
          // It should NOT throw.
          // If it didn't fail, verified must be true.
          if (!isFailed) {
            expect(setOutputMock).toHaveBeenCalledWith('verified', 'true');
          }
        },
      ),
    );
  });

  test('should handle arbitrary API failures', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (errorMessage) => {
        vi.clearAllMocks();
        getInputMock = vi.mocked(core.getInput).mockReturnValue('valid');
        octokitMock.graphql.mockRejectedValue(new Error(errorMessage));

        await run();

        expect(setFailedMock).toHaveBeenCalledWith(errorMessage);
      }),
    );
  });
});
