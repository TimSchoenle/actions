import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentUnavailableError } from './comment-api.js';
import { createCommentApi } from './github-api.js';

import type { ExistingComment } from './comment-api.js';

vi.mock('@actions/github');

const target = { number: 7, owner: 'owner', repo: 'repo' };

interface OctokitMock {
  paginate: { iterator: ReturnType<typeof vi.fn> };
  rest: {
    issues: {
      createComment: ReturnType<typeof vi.fn>;
      listComments: ReturnType<typeof vi.fn>;
      updateComment: ReturnType<typeof vi.fn>;
    };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    paginate: { iterator: vi.fn() },
    rest: { issues: { createComment: vi.fn(), listComments: vi.fn(), updateComment: vi.fn() } },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

/** Mirrors the shape of an Octokit `RequestError`, which carries the HTTP status. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/** Serves REST comment pages through the paginating iterator the adapter asks for. */
function servePages(octokit: OctokitMock, pages: unknown[][]): void {
  octokit.paginate.iterator.mockImplementation(async function* () {
    for (const data of pages) {
      yield { data };
    }
  });
}

async function collect(comments: AsyncIterable<ExistingComment>): Promise<ExistingComment[]> {
  const collected: ExistingComment[] = [];

  for await (const comment of comments) {
    collected.push(comment);
  }

  return collected;
}

describe('createCommentApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  it('reads every page of comments, oldest first', async () => {
    servePages(octokit, [
      [{ body: 'first', html_url: 'https://example.test/1', id: 1, user: { login: 'app[bot]' } }],
      [{ body: 'second', html_url: 'https://example.test/2', id: 2, user: { login: 'human' } }],
    ]);

    await expect(collect(createCommentApi('token').comments(target))).resolves.toEqual([
      { author: 'app[bot]', body: 'first', id: 1, url: 'https://example.test/1' },
      { author: 'human', body: 'second', id: 2, url: 'https://example.test/2' },
    ]);
    expect(octokit.paginate.iterator).toHaveBeenCalledWith(octokit.rest.issues.listComments, {
      issue_number: 7,
      owner: 'owner',
      per_page: 100,
      repo: 'repo',
    });
  });

  it('substitutes empty strings for a deleted author and an empty body', async () => {
    servePages(octokit, [[{ body: null, html_url: 'https://example.test/1', id: 1, user: null }]]);

    await expect(collect(createCommentApi('token').comments(target))).resolves.toEqual([
      { author: '', body: '', id: 1, url: 'https://example.test/1' },
    ]);
  });

  it('stops requesting pages once the consumer stops reading', async () => {
    let pagesRequested = 0;

    octokit.paginate.iterator.mockImplementation(async function* () {
      for (const id of [1, 2, 3]) {
        pagesRequested += 1;
        yield { data: [{ body: 'x', html_url: 'https://example.test/x', id, user: { login: 'app[bot]' } }] };
      }
    });

    for await (const _comment of createCommentApi('token').comments(target)) {
      break;
    }

    expect(pagesRequested).toBe(1);
  });

  it('posts a new comment through the issues endpoint', async () => {
    octokit.rest.issues.createComment.mockResolvedValue({ data: { html_url: 'https://example.test/new', id: 9 } });

    await expect(createCommentApi('token').createComment(target, 'body')).resolves.toEqual({
      id: 9,
      url: 'https://example.test/new',
    });
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: 'body',
      issue_number: 7,
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('replaces the body of an existing comment', async () => {
    octokit.rest.issues.updateComment.mockResolvedValue({ data: { html_url: 'https://example.test/9', id: 9 } });

    await expect(createCommentApi('token').updateComment(target, 9, 'body')).resolves.toEqual({
      id: 9,
      url: 'https://example.test/9',
    });
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      body: 'body',
      comment_id: 9,
      owner: 'owner',
      repo: 'repo',
    });
  });

  it.each([
    [404, 'Not Found'],
    [410, 'Gone'],
  ])('reports an update refused with %i as a comment that is gone', async (status, message) => {
    octokit.rest.issues.updateComment.mockRejectedValue(httpError(status, message));

    await expect(createCommentApi('token').updateComment(target, 9, 'body')).rejects.toThrow(CommentUnavailableError);
  });

  it('keeps the original failure as the cause, for the debug log', async () => {
    const cause = httpError(404, 'Not Found');
    octokit.rest.issues.updateComment.mockRejectedValue(cause);

    await expect(createCommentApi('token').updateComment(target, 9, 'body')).rejects.toMatchObject({ cause });
  });

  // Falling back here would post a comment on every run: the comment that caused the refusal keeps
  // being the oldest one carrying the marker, so the next run finds it and is refused again.
  it('does not treat a refusal to edit somebody else’s comment as a comment that is gone', async () => {
    octokit.rest.issues.updateComment.mockRejectedValue(httpError(403, 'Must have write access to edit this comment'));

    const update = createCommentApi('token').updateComment(target, 9, 'body');

    await expect(update).rejects.toThrow('Must have write access');
    await expect(update).rejects.not.toBeInstanceOf(CommentUnavailableError);
  });

  it('propagates a server error rather than inviting a duplicate comment', async () => {
    octokit.rest.issues.updateComment.mockRejectedValue(httpError(500, 'Internal Server Error'));

    await expect(createCommentApi('token').updateComment(target, 9, 'body')).rejects.toThrow('Internal Server Error');
  });
});
