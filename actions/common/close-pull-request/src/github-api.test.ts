import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPullRequestApi } from './github-api.js';

vi.mock('@actions/github');

const repository = { owner: 'owner', repo: 'repo' };

interface OctokitMock {
  rest: {
    issues: {
      createComment: ReturnType<typeof vi.fn>;
    };
    pulls: {
      get: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    rest: {
      issues: { createComment: vi.fn() },
      pulls: { get: vi.fn(), update: vi.fn() },
    },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

/** Mirrors the shape of an Octokit `RequestError`, which carries the HTTP status. */
function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

describe('createPullRequestApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  it('reports an existing pull request', async () => {
    octokit.rest.pulls.get.mockResolvedValue({ data: { number: 42, state: 'open' } });

    await expect(createPullRequestApi('token').pullRequestExists(repository, 42)).resolves.toBe(true);
    expect(octokit.rest.pulls.get).toHaveBeenCalledWith({ ...repository, pull_number: 42 });
  });

  it('translates a 404 into a missing pull request', async () => {
    octokit.rest.pulls.get.mockRejectedValue(httpError(404, 'Not Found'));

    await expect(createPullRequestApi('token').pullRequestExists(repository, 42)).resolves.toBe(false);
  });

  it.each([
    [401, 'Bad credentials'],
    [403, 'Resource not accessible by integration'],
    [500, 'Server error'],
  ])('propagates a %i response instead of reporting a missing pull request', async (status, message) => {
    octokit.rest.pulls.get.mockRejectedValue(httpError(status, message));

    await expect(createPullRequestApi('token').pullRequestExists(repository, 42)).rejects.toThrow(message);
  });

  it('propagates a transport error without a status', async () => {
    octokit.rest.pulls.get.mockRejectedValue(new Error('socket hang up'));

    await expect(createPullRequestApi('token').pullRequestExists(repository, 42)).rejects.toThrow('socket hang up');
  });

  it('closes the pull request by setting its state', async () => {
    octokit.rest.pulls.update.mockResolvedValue({ data: { state: 'closed' } });

    await expect(createPullRequestApi('token').closePullRequest(repository, 42)).resolves.toBeUndefined();
    expect(octokit.rest.pulls.update).toHaveBeenCalledWith({ ...repository, pull_number: 42, state: 'closed' });
  });

  it('propagates a close failure', async () => {
    octokit.rest.pulls.update.mockRejectedValue(httpError(403, 'Resource not accessible by integration'));

    await expect(createPullRequestApi('token').closePullRequest(repository, 42)).rejects.toThrow(
      'Resource not accessible by integration',
    );
  });

  it('comments through the issues endpoint, so the text lands in the conversation', async () => {
    octokit.rest.issues.createComment.mockResolvedValue({ data: { id: 1 } });

    await expect(createPullRequestApi('token').commentOnPullRequest(repository, 42, 'bye')).resolves.toBeUndefined();
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({ ...repository, body: 'bye', issue_number: 42 });
  });

  it('propagates a comment failure', async () => {
    octokit.rest.issues.createComment.mockRejectedValue(httpError(410, 'Issues are disabled for this repo'));

    await expect(createPullRequestApi('token').commentOnPullRequest(repository, 42, 'bye')).rejects.toThrow(
      'Issues are disabled for this repo',
    );
  });
});
