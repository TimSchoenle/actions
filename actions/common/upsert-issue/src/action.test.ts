import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { ExistingIssue, IssueApi } from './issue-api.js';
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
  identifier: 'repo-state',
  labels: '',
  repository: 'owner/repo',
  reopen_if_closed: 'true',
  search_state: 'all',
  title: 'Repo state',
  token: 'ghs_token',
  update_existing: 'true',
};

function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

interface FakeApi extends IssueApi {
  createIssue: Mock<IssueApi['createIssue']>;
  updateIssue: Mock<IssueApi['updateIssue']>;
}

function fakeApi(existing: ExistingIssue[] = []): FakeApi {
  return {
    createIssue: vi.fn<IssueApi['createIssue']>(async () => ({ number: 99, url: 'https://example.test/99' })),
    issues: async function* (): AsyncIterable<ExistingIssue> {
      yield* existing;
    },
    updateIssue: vi.fn<IssueApi['updateIssue']>(async (_target, number) => ({
      number,
      url: `https://example.test/${number}`,
    })),
  };
}

/** The outputs the action published, keyed by name. */
function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls as [string, string][]);
}

describe('upsert-issue action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens an issue and publishes what it did', async () => {
    const api = fakeApi();

    await run(api);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(api.createIssue).toHaveBeenCalledWith(
      { owner: 'owner', repo: 'repo' },
      'Repo state',
      '<!-- timschoenle/actions:issue:repo-state -->\n\nthe report',
      [],
    );
    expect(outputs()).toEqual({
      issue_number: '99',
      issue_url: 'https://example.test/99',
      operation: 'created',
    });
  });

  it('updates the issue a previous run left behind', async () => {
    const api = fakeApi([
      {
        author: 'app[bot]',
        body: '<!-- timschoenle/actions:issue:repo-state -->\n\nan older report',
        labels: [],
        number: 5,
        state: 'open',
        title: 'Repo state',
        url: 'https://example.test/5',
      },
    ]);

    await run(api);

    expect(api.updateIssue).toHaveBeenCalled();
    expect(outputs()).toMatchObject({ issue_number: '5', operation: 'updated' });
  });

  it('parses a multiline labels input', async () => {
    setInputs({ labels: 'bug\nrepo-state' });
    const api = fakeApi();

    await run(api);

    expect(api.createIssue).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), [
      'bug',
      'repo-state',
    ]);
  });

  it('warns when a body had to be cut short', async () => {
    setInputs({ body: 'x'.repeat(70_000) });

    await run(fakeApi());

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('cut short'));
  });

  it('fails on a repository it cannot parse', async () => {
    setInputs({ repository: 'not-a-repository' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid repository'));
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

  it('fails on a search_state it does not recognise', async () => {
    setInputs({ search_state: 'closed' });

    await run(fakeApi());

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('search_state'));
  });

  // core.info writes to stdout verbatim and the runner parses every line of it for `::` commands,
  // so a value the action did not construct must never reach a log line unquoted.
  it('quotes an identifier into the log rather than letting it start a line', async () => {
    setInputs({ identifier: 'a.b_c-1' });

    await run(fakeApi());

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('"a.b_c-1"'));
  });
});
