import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { CommentApi, ExistingComment } from './comment-api.js';
import type { Mock } from 'vitest';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  author: '',
  body: 'the report',
  body_file: '',
  identifier: 'docker-image-size',
  pr_url: 'https://github.com/owner/repo/pull/7',
  token: 'ghs_token',
  update_existing: 'true',
};

function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

interface FakeApi extends CommentApi {
  createComment: Mock<CommentApi['createComment']>;
  updateComment: Mock<CommentApi['updateComment']>;
}

function fakeApi(existing: ExistingComment[] = []): FakeApi {
  return {
    comments: async function* (): AsyncIterable<ExistingComment> {
      yield* existing;
    },
    createComment: vi.fn<CommentApi['createComment']>(async () => ({ id: 99, url: 'https://example.test/99' })),
    updateComment: vi.fn<CommentApi['updateComment']>(async (_target, id) => ({
      id,
      url: `https://example.test/${id}`,
    })),
  };
}

/** The outputs the action published, keyed by name. */
function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls as [string, string][]);
}

describe('upsert-pr-comment action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('posts a comment and publishes what it did', async () => {
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(api.createComment).toHaveBeenCalledWith(
      { number: 7, owner: 'owner', repo: 'repo' },
      '<!-- timschoenle/actions:pr-comment:docker-image-size -->\n\nthe report',
    );
    expect(outputs()).toEqual({
      comment_id: '99',
      comment_url: 'https://example.test/99',
      operation: 'created',
    });
  });

  it('updates the comment a previous run left behind', async () => {
    const api = fakeApi([
      {
        author: 'app[bot]',
        body: '<!-- timschoenle/actions:pr-comment:docker-image-size -->\n\nan older report',
        id: 5,
        url: 'https://example.test/5',
      },
    ]);

    await run(api);

    expect(api.updateComment).toHaveBeenCalled();
    expect(outputs()).toMatchObject({ comment_id: '5', operation: 'updated' });
  });

  it('warns when a body had to be cut short', async () => {
    setInputs({ body: 'x'.repeat(70_000) });

    await run(fakeApi());

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('cut short'));
  });

  it('fails on a pull request URL it cannot parse', async () => {
    setInputs({ pr_url: 'https://github.com/owner/repo/issues/7' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid pull request URL'));
  });

  it('fails on an identifier that would escape the marker', async () => {
    setInputs({ identifier: 'size --> <img src=x>' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('identifier must be'));
  });

  it('fails when no body is given at all', async () => {
    setInputs({ body: '' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("one of 'body' and 'body_file'"));
  });

  // core.info writes to stdout verbatim and the runner parses every line of it for `::` commands,
  // so a value the action did not construct must never reach a log line unquoted.
  it('quotes an identifier into the log rather than letting it start a line', async () => {
    setInputs({ identifier: 'a.b_c-1' });

    await run(fakeApi());

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('"a.b_c-1"'));
  });
});
