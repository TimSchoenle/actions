import path from 'node:path';

import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { REGION_BEGIN, REGION_END } from './dockerfile-region.js';

import type { ActionDependencies } from './action.js';
import type { CommandResult } from './command.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real, so these exercise
 * the actual `getInput` semantics — the trimming a runner's callers rely on, and the manifest's own
 * defaults reaching the code that reads them — rather than a hand-written stand-in.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  error: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

const WORKSPACE = path.resolve('/workspace');

const LABEL_BLOCK = [REGION_BEGIN, 'LABEL dev.terrace.config.contract.version="1"', REGION_END, ''].join('\n');
const LABELS = 'dev.terrace.config.contract.version=1\n';
const CONTRACT = '{\n  "terrace_contract": 1\n}\n';
const CONTAINER = 'e'.repeat(64);

const DEFAULT_INPUTS: Record<string, string> = {
  source_directory: '.',
  example: 'config-schema',
  package: '',
  features: '',
  dockerfile: 'Dockerfile',
  contract: 'docs/config.contract.json',
  image: 'myservice:test',
  contract_path: '/config/contract.json',
};

function setInputs(overrides: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({ ...DEFAULT_INPUTS, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

interface Scene {
  files?: Record<string, string>;
  renderings?: Partial<Record<'contract' | 'labels' | 'dockerfile', string>>;
  generatorExitCode?: number;
  imageLabels?: string;
  directories?: string[];
}

/** Wires the three ports to a scripted world, leaving every module built on them real. */
function dependencies(scene: Scene = {}): ActionDependencies & { commands: string[][] } {
  const files = new Map(
    Object.entries(
      scene.files ?? { Dockerfile: `FROM scratch\n${LABEL_BLOCK}`, 'docs/config.contract.json': CONTRACT },
    ).map(([relative, content]) => [path.resolve(WORKSPACE, relative), content]),
  );
  const renderings = { contract: CONTRACT, labels: LABELS, dockerfile: LABEL_BLOCK, ...scene.renderings };
  const commands: string[][] = [];

  const runCommand = (command: string, args: readonly string[]): Promise<CommandResult> => {
    commands.push([command, ...args]);

    const answer = (stdout: string, exitCode = 0): Promise<CommandResult> =>
      Promise.resolve({ exitCode, stdout, stderr: '' });

    if (command === 'cargo') {
      const format = args.at(-3) as keyof typeof renderings;

      return answer(renderings[format], scene.generatorExitCode ?? 0);
    }

    if (args[0] === 'inspect') {
      return answer(scene.imageLabels ?? JSON.stringify({ 'dev.terrace.config.contract.version': '1' }));
    }

    if (args[0] === 'cp') {
      files.set(path.resolve(args[2]), CONTRACT);
    }

    return answer(`${CONTAINER}\n`);
  };

  return {
    commands,
    runCommand,
    readFile: (absolutePath) => Promise.resolve(files.get(path.resolve(absolutePath))),
    isDirectory: (absolutePath) =>
      Promise.resolve((scene.directories ?? [WORKSPACE]).some((entry) => path.resolve(entry) === absolutePath)),
  };
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls as [string, string][]);
}

describe('config-contract action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GITHUB_WORKSPACE', WORKSPACE);
    setInputs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes what it checked when everything agrees', async () => {
    await run(dependencies());

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()['checks_run']).toBe('dockerfile-block committed-contract image-labels embedded-contract');
    expect(outputs()['checks_skipped']).toBe('');
    expect(outputs()['contract_checksum']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(outputs()['labels'])).toEqual({ 'dev.terrace.config.contract.version': '1' });
  });

  it('renders three formats before it compares anything', async () => {
    const deps = dependencies();

    await run(deps);

    expect(deps.commands.filter(([command]) => command === 'cargo').map((command) => command.at(-3))).toEqual([
      'contract',
      'labels',
      'dockerfile',
    ]);
  });

  it('annotates every fault and then fails once', async () => {
    await run(dependencies({ imageLabels: '{}', files: {} }));

    expect(vi.mocked(core.error).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    expect(vi.mocked(core.setFailed).mock.calls[0][0]).toMatch(/contract checks? failed/);
  });

  it('anchors a file fault to the file, so the annotation lands on the diff', async () => {
    await run(dependencies({ files: { 'docs/config.contract.json': CONTRACT } }));

    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Dockerfile'), { file: 'Dockerfile' });
  });

  it('publishes its outputs even on the run that failed', async () => {
    await run(dependencies({ imageLabels: '{}' }));

    expect(core.setFailed).toHaveBeenCalled();
    expect(outputs()['contract_checksum']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('says which checks it skipped, so a silent no-op is visible in the log', async () => {
    setInputs({ image: '', contract: '' });

    await run(dependencies());

    expect(outputs()['checks_skipped']).toBe('committed-contract image-labels embedded-contract');
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('committed-contract'));
  });

  it('names the input when the source directory is not there, and runs nothing', async () => {
    setInputs({ source_directory: 'services/api' });
    const deps = dependencies({ directories: [] });

    await run(deps);

    expect(vi.mocked(core.setFailed).mock.calls[0][0]).toContain('source_directory');
    expect(deps.commands).toEqual([]);
  });

  it('fails without comparing anything when the generator fails', async () => {
    const deps = dependencies({ generatorExitCode: 101 });

    await run(deps);

    expect(vi.mocked(core.setFailed).mock.calls[0][0]).toContain('exited with 101');
    expect(deps.commands.filter(([command]) => command === 'docker')).toEqual([]);
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails when a rendering came out blank, rather than comparing against nothing', async () => {
    await run(dependencies({ renderings: { labels: '' } }));

    expect(vi.mocked(core.setFailed).mock.calls[0][0]).toContain('--format labels');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it.each<{ name: string; inputs: Record<string, string> }>([
    { name: 'an example that is a flag', inputs: { example: '--offline' } },
    { name: 'an image that is a flag', inputs: { image: '--privileged' } },
    { name: 'a contract path that is relative', inputs: { contract_path: 'config/contract.json' } },
    { name: 'a dockerfile that escapes the checkout', inputs: { dockerfile: '../../etc/passwd' } },
  ])('refuses $name before running anything', async ({ inputs }) => {
    setInputs(inputs);
    const deps = dependencies();

    await run(deps);

    expect(core.setFailed).toHaveBeenCalled();
    expect(deps.commands).toEqual([]);
  });

  // `core.info` writes to stdout verbatim and the runner reads every line of it for workflow
  // commands, so an input that reached the log unquoted would be executable rather than merely ugly.
  it('quotes the inputs it echoes', async () => {
    setInputs({ features: 'config-schema,cli' });

    await run(dependencies());

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('"config-schema,cli"'));
  });
});
