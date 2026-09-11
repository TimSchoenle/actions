import { describe, expect, it, vi } from 'vitest';

import { IssueUnavailableError } from './issue-api.js';
import { markerFor } from './marker.js';
import { upsertIssue } from './upsert.js';

import type { ExistingIssue, IssueApi } from './issue-api.js';
import type { UpsertRequest } from './upsert.js';
import type { Mock } from 'vitest';

const target = { owner: 'owner', repo: 'repo' };
const marker = markerFor('repo-state');
const composed = `${marker}\n\nthe report`;

function request(overrides: Partial<UpsertRequest> = {}): UpsertRequest {
  return {
    author: '',
    body: 'the report',
    identifier: 'repo-state',
    labels: [],
    reopenIfClosed: true,
    searchState: 'all',
    target,
    title: 'Repo state',
    updateExisting: true,
    ...overrides,
  };
}

function issue(overrides: Partial<ExistingIssue> = {}): ExistingIssue {
  return {
    author: 'app[bot]',
    body: composed,
    labels: [],
    number: 1,
    state: 'open',
    title: 'Repo state',
    url: 'https://github.com/owner/repo/issues/1',
    ...overrides,
  };
}

interface FakeApi extends IssueApi {
  issues: Mock<IssueApi['issues']>;
  createIssue: Mock<IssueApi['createIssue']>;
  updateIssue: Mock<IssueApi['updateIssue']>;
  /** Every issue the scan actually pulled, which is how a case sees that it stopped early. */
  served: ExistingIssue[];
}

/** Serves `pages` from `issues`, one page at a time, recording what the scan consumed. */
function fakeApi(pages: ExistingIssue[][] = []): FakeApi {
  const served: ExistingIssue[] = [];

  return {
    createIssue: vi.fn<IssueApi['createIssue']>(async () => ({
      number: 99,
      url: 'https://example.test/created',
    })),
    issues: vi.fn<IssueApi['issues']>(async function* (): AsyncIterable<ExistingIssue> {
      for (const page of pages) {
        for (const entry of page) {
          served.push(entry);
          yield entry;
        }
      }
    }),
    served,
    updateIssue: vi.fn<IssueApi['updateIssue']>(async (_target, number) => ({
      number,
      url: 'https://example.test/updated',
    })),
  };
}

describe('upsertIssue', () => {
  it('opens an issue when the repository has none', async () => {
    const api = fakeApi();

    await expect(upsertIssue(api, request())).resolves.toEqual({
      issue: { number: 99, url: 'https://example.test/created' },
      operation: 'created',
      truncated: false,
    });
    expect(api.createIssue).toHaveBeenCalledWith(target, 'Repo state', composed, []);
  });

  it('opens an issue when no existing one carries the marker', async () => {
    const api = fakeApi([[issue({ body: 'unrelated chatter' }), issue({ body: `${markerFor('other')}\n\nx` })]]);

    await expect(upsertIssue(api, request())).resolves.toMatchObject({ operation: 'created' });
    expect(api.updateIssue).not.toHaveBeenCalled();
  });

  it('updates the marked issue when the body changed', async () => {
    const api = fakeApi([[issue({ body: `${marker}\n\nan older report`, number: 5 })]]);

    await expect(upsertIssue(api, request())).resolves.toMatchObject({ operation: 'updated' });
    expect(api.updateIssue).toHaveBeenCalledWith(target, 5, {
      body: composed,
      labels: [],
      state: 'open',
      title: 'Repo state',
    });
    expect(api.createIssue).not.toHaveBeenCalled();
  });

  it('updates the marked issue when only the title changed', async () => {
    const api = fakeApi([[issue({ number: 5, title: 'Old title' })]]);

    await expect(upsertIssue(api, request())).resolves.toMatchObject({ operation: 'updated' });
    expect(api.updateIssue).toHaveBeenCalledWith(target, 5, {
      body: composed,
      labels: [],
      state: 'open',
      title: 'Repo state',
    });
  });

  it('writes nothing when the marked issue already says exactly this', async () => {
    const api = fakeApi([[issue({ number: 5 })]]);

    await expect(upsertIssue(api, request())).resolves.toMatchObject({ issue: { number: 5 }, operation: 'unchanged' });
    expect(api.updateIssue).not.toHaveBeenCalled();
    expect(api.createIssue).not.toHaveBeenCalled();
  });

  it('reopens a closed matching issue whose content already matches', async () => {
    const api = fakeApi([[issue({ number: 5, state: 'closed' })]]);

    await expect(upsertIssue(api, request())).resolves.toMatchObject({ issue: { number: 5 }, operation: 'reopened' });
    expect(api.updateIssue).toHaveBeenCalledWith(target, 5, { state: 'open' });
    expect(api.createIssue).not.toHaveBeenCalled();
  });

  it('leaves a closed matching issue closed when reopen_if_closed is false', async () => {
    const api = fakeApi([[issue({ number: 5, state: 'closed' })]]);

    await expect(upsertIssue(api, request({ reopenIfClosed: false }))).resolves.toMatchObject({
      issue: { number: 5 },
      operation: 'unchanged',
    });
    expect(api.updateIssue).not.toHaveBeenCalled();
  });

  it('updates a closed matching issue in place and leaves it closed when reopen_if_closed is false', async () => {
    const api = fakeApi([[issue({ body: `${marker}\n\nan older report`, number: 5, state: 'closed' })]]);

    await expect(upsertIssue(api, request({ reopenIfClosed: false }))).resolves.toMatchObject({ operation: 'updated' });
    expect(api.updateIssue).toHaveBeenCalledWith(target, 5, {
      body: composed,
      labels: [],
      state: 'closed',
      title: 'Repo state',
    });
  });

  it('enforces the label set even when title and body are unchanged', async () => {
    const api = fakeApi([[issue({ labels: ['stale'], number: 5 })]]);

    await expect(upsertIssue(api, request({ labels: ['fresh'] }))).resolves.toMatchObject({ operation: 'updated' });
    expect(api.updateIssue).toHaveBeenCalledWith(target, 5, {
      body: composed,
      labels: ['fresh'],
      state: 'open',
      title: 'Repo state',
    });
  });

  it('ignores label order and duplicates when deciding whether anything changed', async () => {
    const api = fakeApi([[issue({ labels: ['a', 'b'], number: 5 })]]);

    await expect(upsertIssue(api, request({ labels: ['b', 'a', 'a'] }))).resolves.toMatchObject({
      operation: 'unchanged',
    });
    expect(api.updateIssue).not.toHaveBeenCalled();
  });

  it('takes the first marked issue the scan serves when a race left duplicates', async () => {
    const api = fakeApi([
      [issue({ body: `${marker}\n\nold`, number: 2 }), issue({ body: `${marker}\n\nold`, number: 3 })],
    ]);

    await upsertIssue(api, request());

    expect(api.updateIssue).toHaveBeenCalledWith(target, 2, expect.objectContaining({ body: composed }));
  });

  it('stops scanning at the first match rather than draining every page', async () => {
    const api = fakeApi([[issue({ body: `${marker}\n\nold`, number: 2 })], [issue({ number: 3 })]]);

    await upsertIssue(api, request());

    expect(api.served).toHaveLength(1);
  });

  it('skips a marked issue opened by another author when one is required', async () => {
    const api = fakeApi([[issue({ author: 'someone-else', body: `${marker}\n\nforged`, number: 4 })]]);

    await expect(upsertIssue(api, request({ author: 'app[bot]' }))).resolves.toMatchObject({ operation: 'created' });
    expect(api.updateIssue).not.toHaveBeenCalled();
  });

  it('updates a marked issue opened by the required author', async () => {
    const api = fakeApi([[issue({ author: 'app[bot]', body: `${marker}\n\nold`, number: 4 })]]);

    await expect(upsertIssue(api, request({ author: 'app[bot]' }))).resolves.toMatchObject({ operation: 'updated' });
  });

  it('never looks for an existing issue when updating is switched off', async () => {
    const api = fakeApi([[issue({ number: 5 })]]);

    await expect(upsertIssue(api, request({ updateExisting: false }))).resolves.toMatchObject({
      operation: 'created',
    });
    expect(api.issues).not.toHaveBeenCalled();
  });

  it('falls back to a new issue when the one it found is gone', async () => {
    const api = fakeApi([[issue({ body: `${marker}\n\nold`, number: 5 })]]);
    api.updateIssue.mockRejectedValue(new IssueUnavailableError('issue 5 can no longer be updated'));

    const outcome = await upsertIssue(api, request());

    expect(outcome).toMatchObject({ fallbackReason: 'issue 5 can no longer be updated', operation: 'created' });
    expect(api.createIssue).toHaveBeenCalledWith(target, 'Repo state', composed, []);
  });

  it('does not answer an unexplained update failure with a duplicate issue', async () => {
    const api = fakeApi([[issue({ body: `${marker}\n\nold`, number: 5 })]]);
    api.updateIssue.mockRejectedValue(new Error('502 Bad Gateway'));

    await expect(upsertIssue(api, request())).rejects.toThrow('502 Bad Gateway');
    expect(api.createIssue).not.toHaveBeenCalled();
  });

  it('reports a body it had to cut', async () => {
    const api = fakeApi();

    await expect(upsertIssue(api, request({ body: 'x'.repeat(70_000) }))).resolves.toMatchObject({
      truncated: true,
    });
  });

  it('rejects an identifier that would escape the marker before touching the API', async () => {
    const api = fakeApi();

    await expect(upsertIssue(api, request({ identifier: 'size --> x' }))).rejects.toThrow('identifier must be');
    expect(api.issues).not.toHaveBeenCalled();
    expect(api.createIssue).not.toHaveBeenCalled();
  });
});
