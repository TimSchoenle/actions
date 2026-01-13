import * as core from '@actions/core';
import * as github from '@actions/github';
import { print } from 'graphql';
import { VerifyCommitsDocument } from './generated/graphql.js';
import type { VerifyCommitsQuery } from './generated/graphql.js';

// Type alias for commit node from the query
type CommitNode = NonNullable<
  NonNullable<
    Extract<NonNullable<VerifyCommitsQuery['resource']>, { __typename?: 'PullRequest' }>['commits']['nodes']
  >[number]
>;

interface ActionInputs {
  prUrl: string;
  token: string;
  acceptedIds: number[];
}

interface CommitValidation {
  oid: string;
  isAuthorValid: boolean;
  isSignatureValid: boolean;
}

/**
 * Parses and validates action inputs.
 */
function getInputs(): ActionInputs {
  const prUrl = core.getInput('pr_url', { required: true });
  const token = core.getInput('github_token', { required: true });
  const userIdsInput = core.getInput('user_ids', { required: true });

  const acceptedIds = userIdsInput.split(',').map((s) => Number(s.trim()));

  core.info(`Verifying commits for PR: ${prUrl}`);
  core.info(`Accepted User IDs: ${acceptedIds.join(', ')}`);

  return { prUrl, token, acceptedIds };
}

/**
 * Fetches Pull Request commit data via GraphQL.
 */
async function fetchPullRequestCommits(
  token: string,
  prUrl: string,
): Promise<Extract<NonNullable<VerifyCommitsQuery['resource']>, { __typename?: 'PullRequest' }>> {
  const octokit = github.getOctokit(token);

  const response = await octokit.graphql<VerifyCommitsQuery>(print(VerifyCommitsDocument), {
    prUrl,
  });

  const pr = response.resource;

  if (pr?.__typename !== 'PullRequest' || !pr.commits) {
    throw new Error('Could not find Pull Request data from URL');
  }

  return pr;
}

/**
 * Validates a single commit's author and signature.
 */
function validateCommit(node: CommitNode | null | undefined, acceptedIds: number[]): CommitValidation | null {
  if (!node?.commit) return null;

  const commit = node.commit;
  const oid = commit.oid;

  // Check Authors
  const authors = commit.authors?.nodes;
  const isAuthorValid =
    !!authors &&
    authors.length > 0 &&
    authors.every((author) => author?.user?.databaseId && acceptedIds.includes(author.user.databaseId));

  // Check Signature
  const isSignatureValid = commit.signature?.isValid === true;

  return { oid, isAuthorValid, isSignatureValid };
}

/**
 * Validates all commits in a PR.
 * Returns an array of invalid commit OIDs.
 */
function validateAllCommits(nodes: (CommitNode | null)[] | null | undefined, acceptedIds: number[]): string[] {
  const invalidCommits: string[] = [];

  if (!nodes) return invalidCommits;

  for (const node of nodes) {
    const validation = validateCommit(node, acceptedIds);
    if (!validation) continue;

    const { oid, isAuthorValid, isSignatureValid } = validation;

    if (!isAuthorValid || !isSignatureValid) {
      core.error(`Invalid commit: ${oid}. Author Valid: ${isAuthorValid}, Signature Valid: ${isSignatureValid}`);
      invalidCommits.push(oid);
    }
  }

  return invalidCommits;
}

/**
 * Sets action outputs based on validation results.
 */
function setOutputs(invalidCommits: string[]): void {
  if (invalidCommits.length > 0) {
    core.warning('Found invalid commits (author check or signature check failed)');
    core.setOutput('verified', 'false');
    core.setOutput('invalid_commits', invalidCommits.join('\n'));
  } else {
    core.info('All commits verified.');
    core.setOutput('verified', 'true');
    core.setOutput('invalid_commits', '');
  }
}

/**
 * Main action entry point.
 */
export async function run(): Promise<void> {
  try {
    const { prUrl, token, acceptedIds } = getInputs();

    const pr = await fetchPullRequestCommits(token, prUrl);

    const { totalCount, nodes } = pr.commits;

    if (totalCount > 100) {
      core.warning('PR has more than 100 commits. Verification unsafe.');
      core.setOutput('verified', 'false');
      return;
    }

    const invalidCommits = validateAllCommits(nodes, acceptedIds);
    setOutputs(invalidCommits);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('Unknown error occurred');
    }
  }
}

// execute logic if called directly
if (require.main === module) {
  await run();
}
