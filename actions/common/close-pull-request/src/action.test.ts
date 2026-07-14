import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { PullRequestApi } from './close.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput` semantics — including the trimming and the `required` check — instead
 * of a hand-written stand-in.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  comment: '',
  pull_request_id: '42',
  repository: 'owner/repo',
  token: 'ghs_test_token',
};

/** Publishes the inputs the way the Actions runner does: as `INPUT_*` environment variables. */
function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function fakeApi(existingPullRequests: number[] = [42]): PullRequestApi {
  return {
    closePullRequest: vi.fn(async () => undefined),
    commentOnPullRequest: vi.fn(async () => undefined),
    pullRequestExists: vi.fn(async (_repository, pullRequestNumber: number) =>
      existingPullRequests.includes(pullRequestNumber),
    ),
  };
}

describe('close-pull-request action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('closes an open pull request and outputs closed=true', async () => {
    const api = fakeApi();

    await run(api);

    expect(api.closePullRequest).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 42);
    expect(api.commentOnPullRequest).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('closed', 'true');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('posts the comment input before closing', async () => {
    setInputs({ comment: 'Closing in favour of the release PR' });
    const api = fakeApi();

    await run(api);

    expect(api.commentOnPullRequest).toHaveBeenCalledWith(
      { owner: 'owner', repo: 'repo' },
      42,
      'Closing in favour of the release PR',
    );
    expect(core.setOutput).toHaveBeenCalledWith('closed', 'true');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('outputs closed=false and succeeds when the pull request does not exist', async () => {
    const api = fakeApi([]);

    await run(api);

    expect(api.closePullRequest).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('closed', 'false');
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('skipping close'));
  });

  it('fails the step when an existing pull request cannot be closed', async () => {
    const api: PullRequestApi = {
      ...fakeApi(),
      closePullRequest: vi.fn(async () => {
        throw new Error('Resource not accessible by integration');
      }),
    };

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to close PR #42 in owner/repo: Resource not accessible by integration',
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails the step when the comment cannot be posted, leaving the pull request open', async () => {
    setInputs({ comment: 'bye' });
    const closePullRequest = vi.fn(async () => undefined);
    const api: PullRequestApi = {
      ...fakeApi(),
      closePullRequest,
      commentOnPullRequest: vi.fn(async () => {
        throw new Error('Issues are disabled for this repo');
      }),
    };

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to comment on PR #42 in owner/repo: Issues are disabled for this repo',
    );
    expect(closePullRequest).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  // The bash swallowed every probe error, so an expired token reported "PR not found" and the caller
  // carried on as if the pull request had been cleaned up.
  it('fails the step on a probe error that is not a missing pull request', async () => {
    const api: PullRequestApi = {
      ...fakeApi(),
      pullRequestExists: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
    };

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith('Bad credentials');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-1', '1.5'])('fails on the invalid pull_request_id %j', async (pull_request_id) => {
    setInputs({ pull_request_id });
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(
      `Invalid pull_request_id '${pull_request_id}'. Expected a positive integer.`,
    );
    expect(api.pullRequestExists).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails on a malformed repository', async () => {
    setInputs({ repository: 'owner' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith("Invalid repository 'owner'. Expected the format 'owner/repo'.");
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it.each(['pull_request_id', 'repository', 'token'])('fails when the required input %s is missing', async (name) => {
    setInputs({ [name]: '' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(`Input required and not supplied: ${name}`);
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});
