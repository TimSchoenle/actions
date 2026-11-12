import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from 'actions-util/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { modifyYaml } from './modify.js';

/**
 * Only the reporting side of `actions-util/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput` semantics — including the `required` check — instead of a
 * hand-written stand-in.
 */
vi.mock('actions-util/core', async (importOriginal) => ({
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

let workspace: string;
let outside: string;

describe('modify-yaml action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'modify-yaml-workspace-')));
    outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'modify-yaml-outside-')));
    vi.stubEnv('GITHUB_WORKSPACE', workspace);
    setInputs();
    vi.mocked(modifyYaml).mockResolvedValue({ oldValue: '1.0.0', newValue: '2.0.0' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('applies the change and publishes both outputs', async () => {
    await run();

    expect(modifyYaml).toHaveBeenCalledWith(path.join(workspace, 'config.yaml'), 'version', '2.0.0');
    expect(outputs()).toEqual({ 'new-value': '2.0.0', 'old-value': '1.0.0' });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  // An absent key and a key that was empty are different outcomes, so the output is omitted rather
  // than published as an empty string.
  it('omits old-value when the key did not exist', async () => {
    vi.mocked(modifyYaml).mockResolvedValue({ oldValue: undefined, newValue: '2.0.0' });

    await run();

    expect(outputs()).toEqual({ 'new-value': '2.0.0' });
  });

  it('publishes the value that was written, not the input', async () => {
    setInputs({ value: '+Infinity' });
    vi.mocked(modifyYaml).mockResolvedValue({ oldValue: '1.0.0', newValue: 'Infinity' });

    await run();

    expect(outputs()).toEqual({ 'new-value': 'Infinity', 'old-value': '1.0.0' });
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

  // The action reads and rewrites the file, so a committed link or a `..` path would both leak the
  // target into the old-value output and overwrite it.
  describe('workspace containment', () => {
    it.each(['../config.yaml', 'nested/../../config.yaml'])('refuses %s, which leaves the workspace', async (file) => {
      setInputs({ file });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('file'));
      expect(modifyYaml).not.toHaveBeenCalled();
    });

    it('refuses an absolute path', async () => {
      setInputs({ file: path.join(outside, 'config.yaml') });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('must be relative'));
      expect(modifyYaml).not.toHaveBeenCalled();
    });

    it('refuses a committed symbolic link to a file outside the workspace, and leaves the target alone', async () => {
      writeFileSync(path.join(outside, 'config.yaml'), 'version: 1.0.0\n');
      symlinkSync(path.join(outside, 'config.yaml'), path.join(workspace, 'config.yaml'));

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('symbolic link'));
      expect(modifyYaml).not.toHaveBeenCalled();
      expect(readFileSync(path.join(outside, 'config.yaml'), 'utf8')).toBe('version: 1.0.0\n');
    });
  });
});
