import * as github from '@actions/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssueApi } from './github-api.js';
import { IssueUnavailableError } from './issue-api.js';

import type { ExistingIssue } from './issue-api.js';

vi.mock('@actions/github');

const target = { owner: 'owner', repo: 'repo' };

interface OctokitMock {
  paginate: { iterator: ReturnType<typeof vi.fn> };
  rest: {
    issues: {
      create: ReturnType<typeof vi.fn>;
      createLabel: ReturnType<typeof vi.fn>;
      listForRepo: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
}

function mockOctokit(): OctokitMock {
  const octokit: OctokitMock = {
    paginate: { iterator: vi.fn() },
    rest: { issues: { create: vi.fn(), createLabel: vi.fn(), listForRepo: vi.fn(), update: vi.fn() } },
  };

  vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);

  return octokit;
}

/** Mirrors the shape of an Octokit `RequestError`, which carries the HTTP status. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/** Serves REST issue pages through the paginating iterator the adapter asks for. */
function servePages(octokit: OctokitMock, pages: unknown[][]): void {
  octokit.paginate.iterator.mockImplementation(async function* () {
    for (const data of pages) {
      yield { data };
    }
  });
}

async function collect(issues: AsyncIterable<ExistingIssue>): Promise<ExistingIssue[]> {
  const collected: ExistingIssue[] = [];

  for await (const issue of issues) {
    collected.push(issue);
  }

  return collected;
}

describe('createIssueApi', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = mockOctokit();
  });

  it('reads every page of issues, oldest first', async () => {
    servePages(octokit, [
      [
        {
          body: 'first',
          html_url: 'https://example.test/1',
          labels: [{ name: 'bug' }],
          number: 1,
          state: 'open',
          title: 'First',
          user: { login: 'app[bot]' },
        },
      ],
      [
        {
          body: 'second',
          html_url: 'https://example.test/2',
          labels: [],
          number: 2,
          state: 'closed',
          title: 'Second',
          user: { login: 'human' },
        },
      ],
    ]);

    await expect(collect(createIssueApi('token').issues(target, 'all'))).resolves.toEqual([
      {
        author: 'app[bot]',
        body: 'first',
        labels: ['bug'],
        number: 1,
        state: 'open',
        title: 'First',
        url: 'https://example.test/1',
      },
      {
        author: 'human',
        body: 'second',
        labels: [],
        number: 2,
        state: 'closed',
        title: 'Second',
        url: 'https://example.test/2',
      },
    ]);
    expect(octokit.paginate.iterator).toHaveBeenCalledWith(octokit.rest.issues.listForRepo, {
      owner: 'owner',
      per_page: 100,
      repo: 'repo',
      state: 'all',
    });
  });

  it('never yields a pull request, which the listing returns alongside issues', async () => {
    servePages(octokit, [
      [
        {
          body: 'a pull request',
          html_url: 'https://example.test/pr',
          labels: [],
          number: 1,
          pull_request: {},
          state: 'open',
          title: 'A PR',
          user: { login: 'human' },
        },
        {
          body: 'a real issue',
          html_url: 'https://example.test/2',
          labels: [],
          number: 2,
          state: 'open',
          title: 'A real issue',
          user: { login: 'human' },
        },
      ],
    ]);

    await expect(collect(createIssueApi('token').issues(target, 'all'))).resolves.toEqual([
      {
        author: 'human',
        body: 'a real issue',
        labels: [],
        number: 2,
        state: 'open',
        title: 'A real issue',
        url: 'https://example.test/2',
      },
    ]);
  });

  it('substitutes empty strings for a deleted author and an empty body', async () => {
    servePages(octokit, [
      [
        {
          body: null,
          html_url: 'https://example.test/1',
          labels: [],
          number: 1,
          state: 'open',
          title: 'x',
          user: null,
        },
      ],
    ]);

    await expect(collect(createIssueApi('token').issues(target, 'open'))).resolves.toEqual([
      { author: '', body: '', labels: [], number: 1, state: 'open', title: 'x', url: 'https://example.test/1' },
    ]);
  });

  it('stops requesting pages once the consumer stops reading', async () => {
    let pagesRequested = 0;

    octokit.paginate.iterator.mockImplementation(async function* () {
      for (const number of [1, 2, 3]) {
        pagesRequested += 1;
        yield {
          data: [
            {
              body: 'x',
              html_url: 'https://example.test/x',
              labels: [],
              number,
              state: 'open',
              title: 'x',
              user: { login: 'app[bot]' },
            },
          ],
        };
      }
    });

    for await (const _issue of createIssueApi('token').issues(target, 'all')) {
      break;
    }

    expect(pagesRequested).toBe(1);
  });

  it('opens a new issue through the issues endpoint', async () => {
    octokit.rest.issues.create.mockResolvedValue({ data: { html_url: 'https://example.test/new', number: 9 } });

    await expect(createIssueApi('token').createIssue(target, 'Title', 'body', [])).resolves.toEqual({
      number: 9,
      url: 'https://example.test/new',
    });
    expect(octokit.rest.issues.create).toHaveBeenCalledWith({
      body: 'body',
      labels: [],
      owner: 'owner',
      repo: 'repo',
      title: 'Title',
    });
    expect(octokit.rest.issues.createLabel).not.toHaveBeenCalled();
  });

  it('creates a label that does not yet exist before opening an issue with it', async () => {
    octokit.rest.issues.createLabel.mockResolvedValue({ data: {} });
    octokit.rest.issues.create.mockResolvedValue({ data: { html_url: 'https://example.test/new', number: 9 } });

    await createIssueApi('token').createIssue(target, 'Title', 'body', ['bug', 'repo-state']);

    expect(octokit.rest.issues.createLabel).toHaveBeenCalledWith({ name: 'bug', owner: 'owner', repo: 'repo' });
    expect(octokit.rest.issues.createLabel).toHaveBeenCalledWith({ name: 'repo-state', owner: 'owner', repo: 'repo' });
  });

  it('tolerates a label that already exists rather than failing the run', async () => {
    octokit.rest.issues.createLabel.mockRejectedValue(httpError(422, 'Validation Failed'));
    octokit.rest.issues.create.mockResolvedValue({ data: { html_url: 'https://example.test/new', number: 9 } });

    await expect(createIssueApi('token').createIssue(target, 'Title', 'body', ['bug'])).resolves.toBeDefined();
  });

  it('propagates a label creation failure that is not a conflict', async () => {
    octokit.rest.issues.createLabel.mockRejectedValue(httpError(500, 'Internal Server Error'));

    await expect(createIssueApi('token').createIssue(target, 'Title', 'body', ['bug'])).rejects.toThrow(
      'Internal Server Error',
    );
    expect(octokit.rest.issues.create).not.toHaveBeenCalled();
  });

  it('replaces the fields of an existing issue', async () => {
    octokit.rest.issues.update.mockResolvedValue({ data: { html_url: 'https://example.test/9', number: 9 } });

    await expect(
      createIssueApi('token').updateIssue(target, 9, { body: 'body', labels: ['bug'], state: 'open', title: 'Title' }),
    ).resolves.toEqual({ number: 9, url: 'https://example.test/9' });
    expect(octokit.rest.issues.update).toHaveBeenCalledWith({
      body: 'body',
      issue_number: 9,
      labels: ['bug'],
      owner: 'owner',
      repo: 'repo',
      state: 'open',
      title: 'Title',
    });
  });

  it('reopens without touching any other field', async () => {
    octokit.rest.issues.update.mockResolvedValue({ data: { html_url: 'https://example.test/9', number: 9 } });

    await createIssueApi('token').updateIssue(target, 9, { state: 'open' });

    expect(octokit.rest.issues.update).toHaveBeenCalledWith({
      issue_number: 9,
      owner: 'owner',
      repo: 'repo',
      state: 'open',
    });
    expect(octokit.rest.issues.createLabel).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'Not Found'],
    [410, 'Gone'],
  ])('reports an update refused with %i as an issue that is gone', async (status, message) => {
    octokit.rest.issues.update.mockRejectedValue(httpError(status, message));

    await expect(createIssueApi('token').updateIssue(target, 9, { title: 'Title' })).rejects.toThrow(
      IssueUnavailableError,
    );
  });

  it('keeps the original failure as the cause, for the debug log', async () => {
    const cause = httpError(404, 'Not Found');
    octokit.rest.issues.update.mockRejectedValue(cause);

    await expect(createIssueApi('token').updateIssue(target, 9, { title: 'Title' })).rejects.toMatchObject({ cause });
  });

  // Falling back here would open an issue on every run: the issue that caused the refusal keeps
  // being the oldest one carrying the marker, so the next run finds it and is refused again.
  it('does not treat a refusal to edit somebody else’s issue as an issue that is gone', async () => {
    octokit.rest.issues.update.mockRejectedValue(httpError(403, 'Must have write access to edit this issue'));

    const update = createIssueApi('token').updateIssue(target, 9, { title: 'Title' });

    await expect(update).rejects.toThrow('Must have write access');
    await expect(update).rejects.not.toBeInstanceOf(IssueUnavailableError);
  });

  it('propagates a server error rather than inviting a duplicate issue', async () => {
    octokit.rest.issues.update.mockRejectedValue(httpError(500, 'Internal Server Error'));

    await expect(createIssueApi('token').updateIssue(target, 9, { title: 'Title' })).rejects.toThrow(
      'Internal Server Error',
    );
  });
});
