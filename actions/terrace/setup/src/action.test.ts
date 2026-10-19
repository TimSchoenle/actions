import path from 'node:path';

import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

import type { ActionDependencies } from './action.js';
import type { InstallPorts } from './installer.js';

/**
 * Only the reporting side of `@actions/core` is mocked; inputs are published as `INPUT_*`
 * environment variables, the way the runner does.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

const GOOD = 'a'.repeat(64);
const WORKSPACE = path.resolve('/work');
const ARCHIVE = (version: string): string => `terrace-contract-${version}-x86_64-unknown-linux-musl.tar.gz`;

const defaultInputs: Record<string, string> = {
  version: '',
  working_directory: '.',
  oras: 'false',
  cosign_version: 'v3.1.3',
  oras_version: '1.3.4',
  github_token: 'token',
};

function setInputs(overrides: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls as [string, string][]);
}

/** Every checksum list lists every file a test downloads, each with the digest {@link GOOD}. */
function ports(): InstallPorts {
  const lists = [ARCHIVE('0.8.0'), ARCHIVE('0.8.2'), 'cosign-linux-amd64', 'oras_1.3.4_linux_amd64.tar.gz']
    .map((name) => `${GOOD}  ${name}`)
    .join('\n');

  return {
    download: vi.fn((url: string) => Promise.resolve(`/tmp/${path.posix.basename(url)}`)),
    extract: vi.fn(() => Promise.resolve('/tmp/unpacked')),
    cacheDirectory: vi.fn((_d: string, tool: string, version: string) => Promise.resolve(`/cache/${tool}/${version}`)),
    cacheFile: vi.fn((_f: string, _n: string, tool: string, version: string) =>
      Promise.resolve(`/cache/${tool}/${version}`),
    ),
    find: vi.fn(() => ''),
    readText: vi.fn(() => Promise.resolve(lists)),
    sha256: vi.fn(() => Promise.resolve(GOOD)),
    makeExecutable: vi.fn(() => Promise.resolve()),
    run: vi.fn(() => Promise.resolve()),
    info: vi.fn(),
  };
}

function dependencies(files: Record<string, string> = {}): ActionDependencies {
  return {
    ports: ports(),
    runner: { platform: 'linux', arch: 'x64' },
    fetchJson: vi.fn(() =>
      Promise.resolve([
        { tag_name: 'terrace-contract-v0.8.2' },
        { tag_name: 'terrace-contract-v0.8.0' },
        { tag_name: 'terrace-contract-v0.9.0' },
      ]),
    ),
    readText: vi.fn((file: string) =>
      file in files ? Promise.resolve(files[file] ?? '') : Promise.reject(new Error(`ENOENT: ${file}`)),
    ),
    addPath: vi.fn(),
    workspace: WORKSPACE,
  };
}

function failure(): string | undefined {
  return vi.mocked(core.setFailed).mock.calls[0]?.[0] as string | undefined;
}

describe('terrace setup action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('installs an exact version without listing releases', async () => {
    setInputs({ version: '0.8.0' });
    const deps = dependencies();

    await run(deps);

    expect(failure()).toBeUndefined();
    expect(deps.fetchJson).not.toHaveBeenCalled();
    expect(outputs()).toEqual({
      version: '0.8.0',
      path: path.join('/cache/terrace-contract/0.8.0', 'terrace-contract'),
      cosign_path: path.join('/cache/cosign/3.1.3', 'cosign'),
      oras_path: '',
    });
    expect(vi.mocked(deps.addPath).mock.calls).toEqual([['/cache/cosign/3.1.3'], ['/cache/terrace-contract/0.8.0']]);
  });

  it('resolves the cli pin in terrace.yaml to the newest patch of its line', async () => {
    const deps = dependencies({ [path.join(WORKSPACE, 'terrace.yaml')]: 'version: 1\ncli: "0.8"\n' });

    await run(deps);

    expect(failure()).toBeUndefined();
    expect(deps.fetchJson).toHaveBeenCalledWith(expect.any(String), 'token');
    expect(outputs()).toMatchObject({ version: '0.8.2' });
  });

  it('reads terrace.yaml from working_directory', async () => {
    setInputs({ working_directory: 'service' });
    const deps = dependencies({ [path.join(WORKSPACE, 'service', 'terrace.yaml')]: "version: 1\ncli: '0.8.0'\n" });

    await run(deps);

    expect(failure()).toBeUndefined();
    expect(outputs()).toMatchObject({ version: '0.8.0' });
  });

  it('installs oras when asked', async () => {
    setInputs({ version: '0.8.0', oras: 'true' });
    const deps = dependencies();

    await run(deps);

    expect(failure()).toBeUndefined();
    expect(outputs()).toMatchObject({ oras_path: path.join('/cache/oras/1.3.4', 'oras') });
    expect(deps.addPath).toHaveBeenCalledWith('/cache/oras/1.3.4');
  });

  it.each([
    [{ version: 'latest' }, /version: must be MAJOR.MINOR/],
    [{ version: '0.8.0', oras: 'yes' }, /oras: must be true or false/],
    [{ working_directory: '../elsewhere' }, /must not traverse upwards/],
    [{}, /cannot be read/],
    [{ version: '0.8.0', cosign_version: '3.1.3' }, /cosign_version: must be vMAJOR.MINOR.PATCH/],
    [{ version: '0.8.0', cosign_version: 'v3.1.3/../../evil' }, /cosign_version: must be vMAJOR.MINOR.PATCH/],
    [{ version: '0.8.0', oras: 'true', oras_version: 'v1.3.4' }, /oras_version: must be MAJOR.MINOR.PATCH/],
  ])('fails on %j before downloading anything', async (overrides, reason) => {
    setInputs(overrides);
    const deps = dependencies();

    await run(deps);

    expect(failure()).toMatch(reason);
    expect(deps.ports.download).not.toHaveBeenCalled();
  });

  it('ignores oras_version when oras is not requested', async () => {
    setInputs({ version: '0.8.0', oras_version: 'not a version' });

    await run(dependencies());

    expect(failure()).toBeUndefined();
  });

  it('publishes nothing when oras fails to install', async () => {
    setInputs({ version: '0.8.0', oras: 'true' });
    const deps = dependencies();

    vi.mocked(deps.ports.download).mockImplementation((url: string) =>
      url.includes('oras')
        ? Promise.reject(new Error('oras unavailable'))
        : Promise.resolve(`/tmp/${path.posix.basename(url)}`),
    );

    await run(deps);

    expect(failure()).toMatch(/oras unavailable/);
    expect(deps.addPath).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails when no release of the line is published', async () => {
    setInputs({ version: '1.0' });
    const deps = dependencies();

    await run(deps);

    expect(failure()).toMatch(/No terrace-contract 1.0.x release/);
    expect(deps.addPath).not.toHaveBeenCalled();
  });

  it('puts nothing on PATH when verification fails', async () => {
    setInputs({ version: '0.8.0' });
    const deps = dependencies();

    vi.mocked(deps.ports.run).mockRejectedValue(new Error('signature mismatch'));

    await run(deps);

    expect(failure()).toMatch(/could not verify SHA256SUMS.*signature mismatch/);
    expect(deps.addPath).not.toHaveBeenCalled();
  });
});
