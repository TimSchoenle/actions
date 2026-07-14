import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { readYaml } from './read.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput` semantics — including the `required` check — instead of a
 * hand-written stand-in.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

vi.mock('./read.js');

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  file: 'config.yaml',
  key: 'app.database.host',
};

/** Publishes the inputs the way the Actions runner does: as `INPUT_*` environment variables. */
function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls as [string, string][]);
}

describe('read-yaml action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
    vi.mocked(readYaml).mockResolvedValue('localhost');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves the key and publishes the value', async () => {
    await run();

    expect(readYaml).toHaveBeenCalledWith('config.yaml', 'app.database.host');
    expect(outputs()).toEqual({ value: 'localhost' });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  // `core.setOutput` encodes multi-line values with a delimiter, which is exactly what the bash
  // predecessor's `echo "value=$VALUE" >> "$GITHUB_OUTPUT"` failed to do.
  it('publishes a multi-line value unchanged', async () => {
    vi.mocked(readYaml).mockResolvedValue('host: localhost\nport: 5432');

    await run();

    expect(outputs()).toEqual({ value: 'host: localhost\nport: 5432' });
  });

  it('publishes an empty value rather than dropping the output', async () => {
    vi.mocked(readYaml).mockResolvedValue('');

    await run();

    expect(outputs()).toEqual({ value: '' });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it.each(['file', 'key'])('fails when the required input %s is empty', async (name) => {
    setInputs({ [name]: '' });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(name));
    expect(readYaml).not.toHaveBeenCalled();
  });

  it('fails the step when the value cannot be read', async () => {
    vi.mocked(readYaml).mockRejectedValue(new Error('File not found: config.yaml'));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('File not found: config.yaml');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails with a generic message when a non-Error is thrown', async () => {
    vi.mocked(readYaml).mockRejectedValue('boom');

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('Unknown error occurred');
  });
});
