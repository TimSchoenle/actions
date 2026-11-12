import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from 'actions-util/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { readYaml } from './read.js';

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

let workspace: string;
let outside: string;

describe('read-yaml action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'read-yaml-workspace-')));
    outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'read-yaml-outside-')));
    vi.stubEnv('GITHUB_WORKSPACE', workspace);
    setInputs();
    vi.mocked(readYaml).mockResolvedValue('localhost');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('resolves the key and publishes the value', async () => {
    await run();

    expect(readYaml).toHaveBeenCalledWith(path.join(workspace, 'config.yaml'), 'app.database.host');
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

  it('keeps the message when a non-Error is thrown', async () => {
    vi.mocked(readYaml).mockRejectedValue('boom');

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('boom');
  });

  // The file is repository content's choice in many workflows: a committed link or a `..` path would
  // otherwise read any YAML or JSON file on the runner into the log and the value output.
  describe('workspace containment', () => {
    it.each(['../secrets.yaml', 'nested/../../secrets.yaml'])(
      'refuses %s, which leaves the workspace',
      async (file) => {
        setInputs({ file });

        await run();

        expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('file'));
        expect(readYaml).not.toHaveBeenCalled();
      },
    );

    it('refuses an absolute path', async () => {
      setInputs({ file: path.join(outside, 'secrets.yaml') });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('must be relative'));
      expect(readYaml).not.toHaveBeenCalled();
    });

    it('refuses a committed symbolic link to a file outside the workspace', async () => {
      writeFileSync(path.join(outside, 'secrets.yaml'), 'token: hunter2\n');
      symlinkSync(path.join(outside, 'secrets.yaml'), path.join(workspace, 'config.yaml'));

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('symbolic link'));
      expect(readYaml).not.toHaveBeenCalled();
    });

    it('follows a symbolic link that stays inside the workspace', async () => {
      writeFileSync(path.join(workspace, 'real.yaml'), 'a: 1\n');
      symlinkSync(path.join(workspace, 'real.yaml'), path.join(workspace, 'config.yaml'));

      await run();

      expect(readYaml).toHaveBeenCalledWith(path.join(workspace, 'config.yaml'), 'app.database.host');
      expect(core.setFailed).not.toHaveBeenCalled();
    });
  });
});
