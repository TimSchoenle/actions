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
  body_lines: '',
  footer: '',
  header: '',
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
  comments: Mock<CommentApi['comments']>;
  createComment: Mock<CommentApi['createComment']>;
  updateComment: Mock<CommentApi['updateComment']>;
}

function fakeApi(existing: ExistingComment[] = []): FakeApi {
  return {
    comments: vi.fn<CommentApi['comments']>(async function* (): AsyncIterable<ExistingComment> {
      yield* existing;
    }),
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

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("one of 'body', 'body_file' and 'body_lines' must be set"),
    );
  });

  it('posts the lines that survived, between the header and footer', async () => {
    const api = fakeApi();
    setInputs({
      body: '',
      body_lines: '- `README.md`\n\n- `config.example.toml`\n',
      footer: 'Closing.',
      header: 'Re-rendered:',
    });

    await run(api);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(api.createComment).toHaveBeenCalledWith(
      { number: 7, owner: 'owner', repo: 'repo' },
      '<!-- timschoenle/actions:pr-comment:docker-image-size -->\n\n' +
        'Re-rendered:\n\n- `README.md`\n- `config.example.toml`\n\nClosing.',
    );
    expect(outputs()).toMatchObject({ operation: 'created' });
  });

  // `core.getInput` trims the whole value by default, which would strip the indent from a nested
  // first line.
  it('keeps the indent of the first surviving line', async () => {
    const api = fakeApi();
    setInputs({ body: '', body_lines: '\n  - nested\n' });

    await run(api);

    expect(api.createComment).toHaveBeenCalledWith(
      expect.anything(),
      '<!-- timschoenle/actions:pr-comment:docker-image-size -->\n\n  - nested',
    );
  });

  // The early return is what lets a skipped run pass on a `push` event, where `pr_url` is empty, and
  // what leaves an earlier comment alone: it is still true of the push it described.
  it('skips without touching the API when no line survived, even with no pull request to name', async () => {
    const api = fakeApi([
      {
        author: 'app[bot]',
        body: '<!-- timschoenle/actions:pr-comment:docker-image-size -->\n\nan older report',
        id: 5,
        url: 'https://example.test/5',
      },
    ]);
    setInputs({ body: '', body_lines: '\n  \n', footer: 'Closing.', header: 'Re-rendered:', pr_url: '' });

    await run(api);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(api.comments).not.toHaveBeenCalled();
    expect(api.createComment).not.toHaveBeenCalled();
    expect(api.updateComment).not.toHaveBeenCalled();
    expect(outputs()).toEqual({ comment_id: '', comment_url: '', operation: 'skipped' });
    expect(core.info).toHaveBeenCalledWith('Nothing to report; no comment posted.');
  });

  // The runner has already evaluated every `${{ }}`. Anything still shaped like a reference is text a
  // value carried in, and expanding it here would hand that value the job's environment and token.
  it('posts references to secrets, variables and commands verbatim, expanding none of them', async () => {
    const api = fakeApi();
    const canary = 'canary-0c47-secret';
    vi.stubEnv('UPSERT_CANARY', canary);
    const references = [
      '${{ secrets.GITHUB_TOKEN }}',
      '${{ env.UPSERT_CANARY }}',
      '{{ UPSERT_CANARY }}',
      '$UPSERT_CANARY ${UPSERT_CANARY} %UPSERT_CANARY%',
      '$INPUT_TOKEN ${process.env.INPUT_TOKEN}',
      '$(printenv UPSERT_CANARY) `printenv INPUT_TOKEN`',
    ];
    setInputs({ body: '', body_lines: references.join('\n'), header: '$UPSERT_CANARY', footer: '%INPUT_TOKEN%' });

    await run(api);

    const posted = api.createComment.mock.calls[0]?.[1];

    expect(posted).toBe(
      `<!-- timschoenle/actions:pr-comment:docker-image-size -->\n\n$UPSERT_CANARY\n\n${references.join('\n')}` +
        '\n\n%INPUT_TOKEN%',
    );
    expect(posted).not.toContain(canary);
    expect(posted).not.toContain(defaultInputs.token);
  });

  it('refuses a marker line planted through body_lines before reading any comment', async () => {
    const api = fakeApi();
    setInputs({ body: '', body_lines: '- README.md\n<!-- timschoenle/actions:pr-comment:other -->' });

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('carries a comment marker'));
    expect(api.comments).not.toHaveBeenCalled();
    expect(api.createComment).not.toHaveBeenCalled();
  });

  it('fails a run that would skip on an identifier that would escape the marker', async () => {
    setInputs({ body: '', body_lines: '\n', identifier: 'size --> <img src=x>' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('identifier must be'));
    expect(outputs()).toEqual({});
  });

  it.each(['header', 'footer'])('fails on a %s given without body_lines, before any API call', async (input) => {
    const api = fakeApi();
    setInputs({ [input]: 'text' });

    await run(api);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(`'${input}' is only valid with 'body_lines'`));
    expect(api.comments).not.toHaveBeenCalled();
    expect(api.createComment).not.toHaveBeenCalled();
  });

  // core.info writes to stdout verbatim and the runner parses every line of it for `::` commands,
  // so a value the action did not construct must never reach a log line unquoted.
  it('quotes an identifier into the log rather than letting it start a line', async () => {
    setInputs({ identifier: 'a.b_c-1' });

    await run(fakeApi());

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('"a.b_c-1"'));
  });
});
