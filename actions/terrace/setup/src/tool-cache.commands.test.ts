import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecOptions } from '@actions/exec';

// The commands each extraction runs, without running them: `tool-cache.test.ts` extracts real archives.
const { exec, which } = vi.hoisted(() => ({
  exec: vi.fn<(command: string, args?: string[], options?: ExecOptions) => Promise<number>>(),
  which: vi.fn<(tool: string, check?: boolean) => Promise<string>>(),
}));

vi.mock('@actions/exec', () => ({ exec }));
vi.mock('@actions/io', () => ({ which }));
vi.mock('actions-util/core', () => ({ debug: vi.fn() }));

const platform = process.platform;
let root: string;
let env: Record<string, string>;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tool-cache-commands-'));
  env = { RUNNER_TEMP: path.join(root, 'temp'), RUNNER_TOOL_CACHE: path.join(root, 'cache') };
  exec.mockReset().mockResolvedValue(0);
  which.mockReset();
});

afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: platform });
  await rm(root, { recursive: true, force: true });
});

/** The module as loaded on `os`, which it reads once at import. */
async function toolCacheOn(os: NodeJS.Platform): Promise<typeof import('./tool-cache.js')> {
  Object.defineProperty(process, 'platform', { value: os });
  vi.resetModules();

  return import('./tool-cache.js');
}

/** Answers `tar --version` with `banner` on the given stream. */
function tarVersion(banner: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
  exec.mockImplementation(async (command, _args, options) => {
    if (command === 'tar --version') {
      options?.listeners?.[stream]?.(Buffer.from(banner));
    }

    return 0;
  });
}

/** The arguments of the one call to `command`. */
function argsOf(command: string): string[] | undefined {
  const calls = exec.mock.calls.filter(([called]) => called === command);
  expect(calls).toHaveLength(1);

  return calls[0]?.[1];
}

describe('extractTar', () => {
  it('passes GNU tar the flags the toolkit does', async () => {
    const { extractTar } = await toolCacheOn('linux');
    tarVersion('tar (GNU tar) 1.35\n');

    const destination = await extractTar('/downloads/terrace.tar.gz', env);

    expect(path.dirname(destination)).toBe(env.RUNNER_TEMP);
    expect(existsSync(destination)).toBe(true);
    expect(argsOf('tar')).toEqual([
      'xz',
      '--warning=no-unknown-keyword',
      '--overwrite',
      '-C',
      destination,
      '-f',
      '/downloads/terrace.tar.gz',
    ]);
  });

  it('passes another tar only the portable flags, verbose under RUNNER_DEBUG', async () => {
    const { extractTar } = await toolCacheOn('darwin');
    tarVersion('bsdtar 3.5.3 - libarchive 3.7.4\n');

    const destination = await extractTar('/downloads/terrace.tar.gz', { ...env, RUNNER_DEBUG: '1' });

    expect(argsOf('tar')).toEqual(['xz', '-v', '-C', destination, '-f', '/downloads/terrace.tar.gz']);
  });

  it('recognises GNU tar from a version banner written to stderr', async () => {
    const { extractTar } = await toolCacheOn('linux');
    tarVersion('tar (GNU tar) 1.35\n', 'stderr');

    await extractTar('/downloads/terrace.tar.gz', env);

    expect(argsOf('tar')).toContain('--overwrite');
  });

  it('gives GNU tar on Windows --force-local and forward-slashed paths', async () => {
    const { extractTar } = await toolCacheOn('win32');
    tarVersion('tar (GNU tar) 1.35\n');
    // A backslash is an ordinary file name character here, which is enough to see it rewritten.
    const temp = path.join(root, String.raw`runner\temp`);

    const destination = await extractTar(String.raw`C:\downloads\terrace.tar.gz`, { ...env, RUNNER_TEMP: temp });

    expect(argsOf('tar')).toEqual([
      'xz',
      '--force-local',
      '--warning=no-unknown-keyword',
      '--overwrite',
      '-C',
      destination.replaceAll('\\', '/'),
      '-f',
      'C:/downloads/terrace.tar.gz',
    ]);
  });

  it('leaves the paths alone for a Windows tar that is not GNU tar', async () => {
    const { extractTar } = await toolCacheOn('win32');
    tarVersion('bsdtar 3.7.2 - libarchive 3.7.2\n');

    const destination = await extractTar(String.raw`C:\downloads\terrace.tar.gz`, env);

    expect(argsOf('tar')).toEqual(['xz', '-C', destination, '-f', String.raw`C:\downloads\terrace.tar.gz`]);
  });

  it('fails when tar fails', async () => {
    const { extractTar } = await toolCacheOn('linux');
    exec.mockImplementation(async (command) => {
      if (command === 'tar') {
        throw new Error('The process tar failed with exit code 2');
      }

      return 0;
    });

    await expect(extractTar('/downloads/terrace.tar.gz', env)).rejects.toThrow('exit code 2');
  });

  it('needs RUNNER_TEMP', async () => {
    const { extractTar } = await toolCacheOn('linux');

    await expect(extractTar('/downloads/terrace.tar.gz', {})).rejects.toThrow('Expected RUNNER_TEMP to be defined');
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('extractZip', () => {
  it('runs unzip in the new directory, overwriting without a prompt', async () => {
    const { extractZip } = await toolCacheOn('linux');
    which.mockResolvedValue('/usr/bin/unzip');

    const destination = await extractZip('/downloads/terrace.zip', env);

    expect(which).toHaveBeenCalledWith('unzip', true);
    expect(exec).toHaveBeenCalledExactlyOnceWith('"/usr/bin/unzip"', ['-o', '-q', '/downloads/terrace.zip'], {
      cwd: destination,
    });
  });

  it('lets unzip list the files under RUNNER_DEBUG', async () => {
    const { extractZip } = await toolCacheOn('linux');
    which.mockResolvedValue('/usr/bin/unzip');

    await extractZip('/downloads/terrace.zip', { ...env, RUNNER_DEBUG: '1' });

    expect(exec.mock.calls[0]?.[1]).toEqual(['-o', '/downloads/terrace.zip']);
  });

  it('fails when unzip is not installed', async () => {
    const { extractZip } = await toolCacheOn('linux');
    which.mockRejectedValue(new Error('Unable to locate executable file: unzip.'));

    await expect(extractZip('/downloads/terrace.zip', env)).rejects.toThrow('Unable to locate executable file: unzip.');
    expect(exec).not.toHaveBeenCalled();
  });

  it('extracts with pwsh on Windows when it is installed, quoting the paths for PowerShell', async () => {
    const { extractZip } = await toolCacheOn('win32');
    which.mockResolvedValue(String.raw`C:\Program Files\PowerShell\7\pwsh.exe`);

    const destination = await extractZip(String.raw`C:\it's "here".zip`, env);

    expect(which).toHaveBeenCalledExactlyOnceWith('pwsh', false);
    const [command, args] = exec.mock.calls[0] ?? [];
    expect(command).toBe(String.raw`"C:\Program Files\PowerShell\7\pwsh.exe"`);
    expect(args?.slice(0, -1)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Unrestricted',
      '-Command',
    ]);
    const script = args?.at(-1);
    // A single quote doubled, and the double quotes, which could end the command line, dropped.
    expect(script).toContain(
      String.raw`[System.IO.Compression.ZipFile]::ExtractToDirectory('C:\it''s here.zip', '${destination}', $true)`,
    );
    expect(script).toContain(String.raw`Expand-Archive -LiteralPath 'C:\it''s here.zip'`);
  });

  it('falls back to Windows PowerShell without pwsh', async () => {
    const { extractZip } = await toolCacheOn('win32');
    which.mockImplementation(async (tool) =>
      tool === 'powershell' ? String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` : '',
    );

    const destination = await extractZip(String.raw`C:\downloads\terrace.zip`, env);

    expect(which).toHaveBeenLastCalledWith('powershell', true);
    const [command, args] = exec.mock.calls[0] ?? [];
    expect(command).toBe(String.raw`"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"`);
    expect(args?.slice(0, -1)).toEqual([
      '-NoLogo',
      '-Sta',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Unrestricted',
      '-Command',
    ]);
    expect(args?.at(-1)).toContain(
      String.raw`Expand-Archive -LiteralPath 'C:\downloads\terrace.zip' -DestinationPath '${destination}' -Force`,
    );
  });

  it('fails on Windows when no PowerShell is installed', async () => {
    const { extractZip } = await toolCacheOn('win32');
    which.mockImplementation(async (tool) => {
      if (tool === 'powershell') {
        throw new Error('Unable to locate executable file: powershell.');
      }

      return '';
    });

    await expect(extractZip(String.raw`C:\downloads\terrace.zip`, env)).rejects.toThrow(
      'Unable to locate executable file: powershell.',
    );
    expect(exec).not.toHaveBeenCalled();
  });
});
