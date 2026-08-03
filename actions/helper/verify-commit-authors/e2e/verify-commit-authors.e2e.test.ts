import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { createOctokit } from 'actions-util/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/helper/verify-commit-authors`, replacing the `verify` job and the
 * four-way `verify-input-validation` matrix of `verify-action-helper-verify-commit-authors.yaml`.
 *
 * The fixture had to change shape. The workflow verified the pull request that triggered it —
 * `github.event.pull_request.html_url` — and derived the expected author IDs from that same pull
 * request with a GraphQL query, so the positive case asserted little more than that two readings of
 * one API agree. Here the pull request is built on the scratch repository and its author is known
 * before the action runs: the accepted ID is the account behind the token, and the rejected commits
 * are the exact SHAs the fixture created.
 *
 * The commits are written with `createCommitOnBranch` rather than `scratch.commitFile`. This action
 * requires a valid signature, and the REST contents API `commitFile` uses leaves a commit unsigned
 * when the caller is a user token — the positive case could never pass with that fixture. The
 * GraphQL mutation is the one write path GitHub signs on the caller's behalf while still attributing
 * the commit to the token's own account.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

/** A user database ID that is never the fixture's author, standing in for "some other account". */
const FOREIGN_USER_ID = '1';

const CREATE_COMMIT_MUTATION = `mutation SignedCommit($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit {
      oid
    }
  }
}`;

interface SignedCommitResponse {
  createCommitOnBranch: { commit: { oid: string } };
}

describe('verify-commit-authors', () => {
  const scratch = ScratchRepo.fromEnvironment('verify-commit-authors');
  const octokit = createOctokit(scratch.token);

  let prUrl: string;
  let commitShas: string[];
  let authorId: string;

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { github_token: scratch.token, ...inputs },
      secrets: [scratch.token],
      expect: expected,
    });
  }

  /** Appends one signed commit to a branch and returns its SHA, once the ref has converged on it. */
  async function commitSigned(branch: string, headOid: string, name: string): Promise<string> {
    const response = (await octokit.graphql(CREATE_COMMIT_MUTATION, {
      input: {
        branch: { branchName: branch, repositoryNameWithOwner: scratch.repository },
        expectedHeadOid: headOid,
        fileChanges: {
          additions: [{ contents: Buffer.from(`${name}\n`, 'utf8').toString('base64'), path: `${branch}/${name}.txt` }],
        },
        message: { headline: `test: ${name} fixture commit` },
      },
    })) as SignedCommitResponse;

    return scratch.headOf(branch, response.createCommitOnBranch.commit.oid);
  }

  beforeAll(async () => {
    const branch = scratch.branch('authored');
    const base = await scratch.createBranch(branch);

    // Two commits, so the negative case can assert that *every* commit is reported, not just one.
    const first = await commitSigned(branch, base, 'first');
    const second = await commitSigned(branch, first, 'second');

    commitShas = [first, second];
    authorId = String(await scratch.accountId());

    const number = await scratch.createPullRequest(
      branch,
      await scratch.defaultBranch(),
      '[e2e] verify-commit-authors',
    );

    prUrl = `https://github.com/${scratch.repository}/pull/${number}`;
  });

  afterAll(() => scratch.teardown());

  it('verifies a pull request whose commits are authored by an accepted user', async () => {
    const result = await run({ pr_url: prUrl, user_ids: authorId });

    expect(result.outputs).toEqual({ verified: 'true', invalid_commits: '' });
  });

  it('accepts the author among several allowed IDs', async () => {
    const result = await run({ pr_url: prUrl, user_ids: `${FOREIGN_USER_ID}, ${authorId}` });

    expect(result.outputs).toEqual({ verified: 'true', invalid_commits: '' });
  });

  it('reports every commit as invalid when the author is not accepted', async () => {
    const result = await run({ pr_url: prUrl, user_ids: FOREIGN_USER_ID });

    expect(result.outputs).toEqual({ verified: 'false', invalid_commits: commitShas.join('\n') });
    expect(result.errors).toHaveLength(commitShas.length);
  });

  // The workflow's four-way validation matrix, which cost four runners.
  it.each([
    {
      name: 'a non-numeric user ID',
      inputs: { pr_url: `https://github.com/${scratch.repository}/pull/1`, user_ids: 'not-an-id' },
      message: "Invalid user ID 'not-an-id'",
    },
    {
      name: 'one malformed ID among valid ones',
      inputs: { pr_url: `https://github.com/${scratch.repository}/pull/1`, user_ids: '29139614, oops' },
      message: "Invalid user ID 'oops'",
    },
    {
      name: 'a list holding nothing but separators',
      inputs: { pr_url: `https://github.com/${scratch.repository}/pull/1`, user_ids: ' , ' },
      message: 'No accepted user IDs provided',
    },
    {
      name: 'a URL that is not a pull request',
      inputs: { pr_url: `https://github.com/${scratch.repository}`, user_ids: '29139614' },
      message: 'Could not find Pull Request data from URL',
    },
  ])('rejects $name', async ({ inputs, message }) => {
    const result = await run(inputs, 'failure');

    expect(result.errors.join('\n')).toContain(message);
    // A failed run must publish no verdict: an empty `verified` is not a rejection.
    expect(result.outputs).toEqual({});
  });
});
