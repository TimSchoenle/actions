import * as core from 'actions-util/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseLiteralPaths, run } from './action.js';

import type { CommitChangesDeps } from './commit.js';

vi.mock('actions-util/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  branch: 'main',
  commit_message: 'chore: update',
  file_pattern: '.',
  repository: 'owner/repo',
  token: 'ghs_token',
};

function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

/** Deps whose git reports the given status and whose API records the commit it is asked to create. */
function fakeDeps(status = '', checkedOut?: string): CommitChangesDeps {
  return {
    api: {
      createCommit: vi.fn(async () => ({ oid: 'newsha', url: 'https://example/commit/newsha' })),
      getHeadOid: vi.fn(async () => 'headsha'),
    },
    git: {
      checkedOutHead: vi.fn(async () => checkedOut),
      ignoreFileModeChanges: vi.fn(async () => {}),
      status: vi.fn(async () => status),
    },
    workspace: {
      exists: () => true,
      readBase64: () => 'aGk=',
    },
  };
}

describe('commit-changes action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes the commit hash, url and changes_detected when a commit is made', async () => {
    await run(fakeDeps(' M a.ts\0'));

    expect(core.setOutput).toHaveBeenCalledWith('commit_hash', 'newsha');
    expect(core.setOutput).toHaveBeenCalledWith('commit_url', 'https://example/commit/newsha');
    expect(core.setOutput).toHaveBeenCalledWith('changes_detected', 'true');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('warns when the expected head had to be read from the remote', async () => {
    await run(fakeDeps(' M a.ts\0'));

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('expected_head_sha'));
  });

  it('does not warn when the target branch is checked out', async () => {
    await run(fakeDeps(' M a.ts\0', 'c'.repeat(40)));

    expect(core.warning).not.toHaveBeenCalled();
  });

  it('passes expected_head_sha to the commit', async () => {
    setInputs({ expected_head_sha: 'd'.repeat(40) });
    const deps = fakeDeps(' M a.ts\0');

    await run(deps);

    expect(deps.api.createCommit).toHaveBeenCalledWith(expect.objectContaining({ expectedHeadOid: 'd'.repeat(40) }));
  });

  it('reports changes_detected=false and no hash when the tree is clean', async () => {
    await run(fakeDeps(''));

    expect(core.setOutput).toHaveBeenCalledWith('changes_detected', 'false');
    expect(core.setOutput).not.toHaveBeenCalledWith('commit_hash', expect.anything());
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails when the required commit_message is missing', async () => {
    setInputs({ commit_message: '' });

    await run(fakeDeps(' M a.ts\0'));

    expect(core.setFailed).toHaveBeenCalledWith('Input required and not supplied: commit_message');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails when the required token is missing', async () => {
    setInputs({ token: '' });

    await run(fakeDeps(' M a.ts\0'));

    expect(core.setFailed).toHaveBeenCalledWith('Input required and not supplied: token');
  });

  it('fails with a branch-specific message when the branch resolves to empty', async () => {
    setInputs({ branch: '' });

    await run(fakeDeps(' M a.ts\0'));

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('No branch given'));
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});

describe('parseLiteralPaths', () => {
  it('keeps one path per line, spaces and glob characters included', () => {
    expect(parseLiteralPaths('docs/my page.md\na*b.txt')).toEqual(['docs/my page.md', 'a*b.txt']);
  });

  it('drops a Windows line ending and blank lines', () => {
    expect(parseLiteralPaths('one.txt\r\n\n  \ntwo.txt\n')).toEqual(['one.txt', 'two.txt']);
  });

  it('is empty for an empty input', () => {
    expect(parseLiteralPaths('')).toEqual([]);
  });
});
