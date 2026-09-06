import { describe, expect, it, vi } from 'vitest';

import { CommentUnavailableError } from './comment-api.js';
import { markerFor } from './marker.js';
import { upsertComment } from './upsert.js';

import type { CommentApi, ExistingComment } from './comment-api.js';
import type { UpsertRequest } from './upsert.js';
import type { Mock } from 'vitest';

const target = { number: 7, owner: 'owner', repo: 'repo' };
const marker = markerFor('size');
const composed = `${marker}\n\nthe report`;

function request(overrides: Partial<UpsertRequest> = {}): UpsertRequest {
  return { author: '', body: 'the report', identifier: 'size', target, updateExisting: true, ...overrides };
}

function comment(overrides: Partial<ExistingComment> = {}): ExistingComment {
  return {
    author: 'app[bot]',
    body: composed,
    id: 1,
    url: 'https://github.com/owner/repo/pull/7#issuecomment-1',
    ...overrides,
  };
}

interface FakeApi extends CommentApi {
  comments: Mock<CommentApi['comments']>;
  createComment: Mock<CommentApi['createComment']>;
  updateComment: Mock<CommentApi['updateComment']>;
  /** Every comment the scan actually pulled, which is how a case sees that it stopped early. */
  served: ExistingComment[];
}

/** Serves `pages` from `comments`, one page at a time, recording what the scan consumed. */
function fakeApi(pages: ExistingComment[][] = []): FakeApi {
  const served: ExistingComment[] = [];

  return {
    comments: vi.fn<CommentApi['comments']>(async function* (): AsyncIterable<ExistingComment> {
      for (const page of pages) {
        for (const entry of page) {
          served.push(entry);
          yield entry;
        }
      }
    }),
    createComment: vi.fn<CommentApi['createComment']>(async () => ({ id: 99, url: 'https://example.test/created' })),
    served,
    updateComment: vi.fn<CommentApi['updateComment']>(async (_target, id) => ({
      id,
      url: 'https://example.test/updated',
    })),
  };
}

describe('upsertComment', () => {
  it('creates a comment when the pull request has none', async () => {
    const api = fakeApi();

    await expect(upsertComment(api, request())).resolves.toEqual({
      comment: { id: 99, url: 'https://example.test/created' },
      operation: 'created',
      truncated: false,
    });
    expect(api.createComment).toHaveBeenCalledWith(target, composed);
  });

  it('creates a comment when no existing one carries the marker', async () => {
    const api = fakeApi([[comment({ body: 'unrelated chatter' }), comment({ body: `${markerFor('other')}\n\nx` })]]);

    await expect(upsertComment(api, request())).resolves.toMatchObject({ operation: 'created' });
    expect(api.updateComment).not.toHaveBeenCalled();
  });

  it('updates the marked comment when the body changed', async () => {
    const api = fakeApi([[comment({ body: `${marker}\n\nan older report`, id: 5 })]]);

    await expect(upsertComment(api, request())).resolves.toMatchObject({ operation: 'updated' });
    expect(api.updateComment).toHaveBeenCalledWith(target, 5, composed);
    expect(api.createComment).not.toHaveBeenCalled();
  });

  it('writes nothing when the marked comment already says exactly this', async () => {
    const api = fakeApi([[comment({ id: 5 })]]);

    await expect(upsertComment(api, request())).resolves.toMatchObject({ comment: { id: 5 }, operation: 'unchanged' });
    expect(api.updateComment).not.toHaveBeenCalled();
    expect(api.createComment).not.toHaveBeenCalled();
  });

  it('takes the oldest marked comment when a race left duplicates', async () => {
    const api = fakeApi([[comment({ body: `${marker}\n\nold`, id: 2 }), comment({ body: `${marker}\n\nold`, id: 3 })]]);

    await upsertComment(api, request());

    expect(api.updateComment).toHaveBeenCalledWith(target, 2, composed);
  });

  it('stops scanning at the first match rather than draining every page', async () => {
    const api = fakeApi([[comment({ body: `${marker}\n\nold`, id: 2 })], [comment({ id: 3 })]]);

    await upsertComment(api, request());

    expect(api.served).toHaveLength(1);
  });

  it('skips a marked comment posted by another author when one is required', async () => {
    const api = fakeApi([[comment({ author: 'someone-else', body: `${marker}\n\nforged`, id: 4 })]]);

    await expect(upsertComment(api, request({ author: 'app[bot]' }))).resolves.toMatchObject({ operation: 'created' });
    expect(api.updateComment).not.toHaveBeenCalled();
  });

  it('updates a marked comment posted by the required author', async () => {
    const api = fakeApi([[comment({ author: 'app[bot]', body: `${marker}\n\nold`, id: 4 })]]);

    await expect(upsertComment(api, request({ author: 'app[bot]' }))).resolves.toMatchObject({ operation: 'updated' });
  });

  it('never looks for an existing comment when updating is switched off', async () => {
    const api = fakeApi([[comment({ id: 5 })]]);

    await expect(upsertComment(api, request({ updateExisting: false }))).resolves.toMatchObject({
      operation: 'created',
    });
    expect(api.comments).not.toHaveBeenCalled();
  });

  it('falls back to a new comment when the one it found is gone', async () => {
    const api = fakeApi([[comment({ body: `${marker}\n\nold`, id: 5 })]]);
    api.updateComment.mockRejectedValue(new CommentUnavailableError('comment 5 can no longer be updated'));

    const outcome = await upsertComment(api, request());

    expect(outcome).toMatchObject({ fallbackReason: 'comment 5 can no longer be updated', operation: 'created' });
    expect(api.createComment).toHaveBeenCalledWith(target, composed);
  });

  it('does not answer an unexplained update failure with a duplicate comment', async () => {
    const api = fakeApi([[comment({ body: `${marker}\n\nold`, id: 5 })]]);
    api.updateComment.mockRejectedValue(new Error('502 Bad Gateway'));

    await expect(upsertComment(api, request())).rejects.toThrow('502 Bad Gateway');
    expect(api.createComment).not.toHaveBeenCalled();
  });

  it('reports a body it had to cut', async () => {
    const api = fakeApi();

    await expect(upsertComment(api, request({ body: 'x'.repeat(70_000) }))).resolves.toMatchObject({
      truncated: true,
    });
  });

  it('rejects an identifier that would escape the marker before touching the API', async () => {
    const api = fakeApi();

    await expect(upsertComment(api, request({ identifier: 'size --> x' }))).rejects.toThrow('identifier must be');
    expect(api.comments).not.toHaveBeenCalled();
    expect(api.createComment).not.toHaveBeenCalled();
  });
});
