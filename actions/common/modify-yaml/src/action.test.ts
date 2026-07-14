import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { modifyYaml } from './modify.js';

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

vi.mock('./modify.js');

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  file: 'config.yaml',
  key: 'version',
  value: '2.0.0',
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

describe('modify-yaml action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
    vi.mocked(modifyYaml).mockResolvedValue('1.0.0');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('applies the change and publishes both outputs', async () => {
    await run();

    expect(modifyYaml).toHaveBeenCalledWith('config.yaml', 'version', '2.0.0');
    expect(outputs()).toEqual({ 'new-value': '2.0.0', 'old-value': '1.0.0' });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  // An absent key and a key that was empty are different outcomes, so the output is omitted rather
  // than published as an empty string.
  it('omits old-value when the key did not exist', async () => {
    vi.mocked(modifyYaml).mockResolvedValue(undefined);

    await run();

    expect(outputs()).toEqual({ 'new-value': '2.0.0' });
  });

  it.each(['file', 'key', 'value'])('fails when the required input %s is empty', async (name) => {
    setInputs({ [name]: '' });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(name));
    expect(modifyYaml).not.toHaveBeenCalled();
  });

  it('fails the step when the file cannot be modified', async () => {
    vi.mocked(modifyYaml).mockRejectedValue(new Error('config.yaml: not found'));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('config.yaml: not found');
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});
