import { createOctokit } from 'actions-util/client';

import type { FileChanges } from './changes.js';
import type { RepositoryCoordinates } from 'actions-util';

/** A commit created by the GraphQL API. */
export interface CreatedCommit {
  /** Full commit SHA. */
  oid: string;
  /** URL of the created commit. */
  url: string;
}

/** Everything the commit API needs to add one commit to the tip of a branch. */
export interface CreateCommitRequest {
  coordinates: RepositoryCoordinates;
  branch: string;
  /** The commit message; its first line becomes the headline and the rest, if any, the body. */
  message: string;
  /** The commit the branch is expected to point at, rejecting the write if it has since moved. */
  expectedHeadOid: string;
  fileChanges: FileChanges;
}

/** The GitHub operations this action needs, kept minimal so it can be faked in tests. */
export interface CommitApi {
  /** Resolves the commit the branch currently points at. Throws when the branch does not exist. */
  getHeadOid(coordinates: RepositoryCoordinates, branch: string): Promise<string>;
  /** Creates a verified commit at the tip of the branch and returns it. */
  createCommit(request: CreateCommitRequest): Promise<CreatedCommit>;
}

/**
 * Creates a commit through the GraphQL `createCommitOnBranch` mutation.
 *
 * This mutation — not the git push a runner would otherwise do — is what makes the commit verified:
 * GitHub signs commits it authors on the caller's behalf, so a bot's commits show as verified without
 * the workflow ever holding a signing key. It replaces the third-party `ghcommit-action` the composite
 * version depended on.
 */
const CREATE_COMMIT_MUTATION = `mutation CreateCommit($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit {
      oid
      url
    }
  }
}`;

/** Shape of the `createCommitOnBranch` response, narrowed to the fields this action reads. */
interface CreateCommitResponse {
  createCommitOnBranch: {
    commit: CreatedCommit | null;
  } | null;
}

/** The `CommitMessage` input, split so a multi-line message keeps its headline and body separate. */
interface CommitMessage {
  headline: string;
  body?: string;
}

/**
 * Splits a commit message into the headline and body `createCommitOnBranch` expects.
 *
 * Only the first newline splits the two; the blank line conventionally separating them is dropped so
 * the body does not start with a stray empty line. A single-line message has no body at all.
 */
export function toCommitMessage(message: string): CommitMessage {
  const newlineIndex = message.indexOf('\n');

  if (newlineIndex === -1) {
    return { headline: message };
  }

  const headline = message.slice(0, newlineIndex);
  const body = message.slice(newlineIndex + 1).replace(/^\n+/, '');

  return body === '' ? { headline } : { body, headline };
}

/** The `CreateCommitOnBranchInput` for the signed `createCommitOnBranch` mutation. */
function buildCommitInput(request: CreateCommitRequest): Record<string, unknown> {
  const { branch, coordinates, expectedHeadOid, fileChanges, message } = request;

  // `fileChanges` always carries at least one addition or deletion: a commit is only ever built when
  // the tree has matching changes, so there is no empty-commit case to special-case here.
  return {
    branch: {
      branchName: branch,
      repositoryNameWithOwner: `${coordinates.owner}/${coordinates.repo}`,
    },
    expectedHeadOid,
    fileChanges,
    message: toCommitMessage(message),
  };
}

export function createCommitApi(token: string): CommitApi {
  const octokit = createOctokit(token);

  return {
    async createCommit(request: CreateCommitRequest): Promise<CreatedCommit> {
      const response = await octokit.graphql<CreateCommitResponse>(CREATE_COMMIT_MUTATION, {
        input: buildCommitInput(request),
      });

      const commit = response.createCommitOnBranch?.commit;

      if (!commit) {
        throw new Error('GitHub did not return the created commit; the commit may have been rejected.');
      }

      return { oid: commit.oid, url: commit.url };
    },

    async getHeadOid({ owner, repo }: RepositoryCoordinates, branch: string): Promise<string> {
      const { data } = await octokit.rest.git.getRef({ owner, ref: `heads/${branch}`, repo });

      return data.object.sha;
    },
  };
}
