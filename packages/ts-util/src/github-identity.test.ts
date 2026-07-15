import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppUserApi } from './github-identity.js';

vi.mock('@actions/github');

interface OctokitMock {
  rest: {
    users: {
      getByUsername: ReturnType<typeof vi.fn>;
    };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    rest: { users: { getByUsername: vi.fn() } },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

/** Mirrors the shape of an Octokit `RequestError`, which carries the HTTP status. */
function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

describe('createAppUserApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  it('reads the numeric id of the bot user', async () => {
    octokit.rest.users.getByUsername.mockResolvedValue({ data: { id: 123456, login: 'my-app[bot]' } });

    await expect(createAppUserApi('token').getUserId('my-app[bot]')).resolves.toBe(123456);
    expect(octokit.rest.users.getByUsername).toHaveBeenCalledWith({ username: 'my-app[bot]' });
  });

  it('translates a 404 into an unknown user', async () => {
    octokit.rest.users.getByUsername.mockRejectedValue(httpError(404, 'Not Found'));

    await expect(createAppUserApi('token').getUserId('typo-app[bot]')).resolves.toBeUndefined();
  });

  it.each([
    [401, 'Bad credentials'],
    [403, 'Resource not accessible by integration'],
    [500, 'Server error'],
  ])('propagates a %i response instead of reporting an unknown user', async (status, message) => {
    octokit.rest.users.getByUsername.mockRejectedValue(httpError(status, message));

    await expect(createAppUserApi('token').getUserId('my-app[bot]')).rejects.toThrow(message);
  });

  it('propagates a transport error without a status', async () => {
    octokit.rest.users.getByUsername.mockRejectedValue(new Error('socket hang up'));

    await expect(createAppUserApi('token').getUserId('my-app[bot]')).rejects.toThrow('socket hang up');
  });
});
