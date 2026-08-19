import { execFile } from 'node:child_process';
import { access, constants, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { StubCommands } from './stub-commands.js';

const run = promisify(execFile);

/**
 * Runs a stub's script the way its shim does, without going through the shell.
 *
 * The shim itself — a `.cmd` on Windows, a `sh` script elsewhere — is exercised for real by the
 * action cases that resolve it from `PATH`; what is worth pinning down here is the behaviour it
 * delegates to, which is identical on every platform.
 */
async function invoke(stubs: StubCommands, command: string, args: string[], cwd = process.cwd()) {
  try {
    const { stdout, stderr } = await run(process.execPath, [path.join(stubs.path, `${command}.stub.mjs`), ...args], {
      cwd,
    });

    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };

    return { exitCode: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('StubCommands', () => {
  let stubs: StubCommands;

  afterEach(async () => {
    await stubs.dispose();
  });

  it('answers from the first rule whose arguments all match', async () => {
    stubs = await StubCommands.create({
      cargo: [
        { when: ['--format', 'contract'], stdout: 'the contract' },
        { when: ['--format', 'labels'], stdout: 'the labels' },
        { stdout: 'anything else' },
      ],
    });

    await expect(invoke(stubs, 'cargo', ['run', '--format', 'labels'])).resolves.toMatchObject({
      stdout: 'the labels',
    });
    await expect(invoke(stubs, 'cargo', ['run', '--format', 'contract'])).resolves.toMatchObject({
      stdout: 'the contract',
    });
    await expect(invoke(stubs, 'cargo', ['build'])).resolves.toMatchObject({ stdout: 'anything else' });
  });

  it('matches arguments by equality, so a substring does not select a rule', async () => {
    stubs = await StubCommands.create({ docker: [{ when: ['rm'], stdout: 'removed' }, { stdout: 'other' }] });

    await expect(invoke(stubs, 'docker', ['rmi', 'api'])).resolves.toMatchObject({ stdout: 'other' });
  });

  it('reports an exit code and stderr', async () => {
    stubs = await StubCommands.create({ cargo: [{ exitCode: 101, stderr: 'error: no such example' }] });

    await expect(invoke(stubs, 'cargo', ['run'])).resolves.toMatchObject({
      exitCode: 101,
      stderr: 'error: no such example',
    });
  });

  // A stub that quietly succeeded on an unforeseen call would let an action change what it runs
  // without any case noticing.
  it('fails loudly when no rule matches, rather than succeeding silently', async () => {
    stubs = await StubCommands.create({ docker: [{ when: ['inspect'] }] });

    const result = await invoke(stubs, 'docker', ['push', 'api']);

    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('no rule matches');
  });

  // For a tool whose contract is to produce a file rather than to print one, which is `docker cp`.
  it('writes the file named by the last argument', async () => {
    stubs = await StubCommands.create({ docker: [{ when: ['cp'], writeFinalArgument: '{"terrace_contract":1}' }] });
    const destination = path.join(stubs.path, 'nested', 'copied.json');

    await invoke(stubs, 'docker', ['cp', 'abc:/config/contract.json', destination]);

    await expect(readFile(destination, 'utf8')).resolves.toBe('{"terrace_contract":1}');
  });

  it('records every call in order, with its arguments and working directory', async () => {
    stubs = await StubCommands.create({ cargo: [{ stdout: 'x' }], docker: [{ stdout: 'y' }] });

    await invoke(stubs, 'cargo', ['run', '--quiet'], stubs.path);
    await invoke(stubs, 'docker', ['inspect', 'api']);

    const invocations = await stubs.invocations();

    expect(invocations.map((invocation) => invocation.command)).toEqual(['cargo', 'docker']);
    expect(invocations[0].args).toEqual(['run', '--quiet']);
    expect(path.resolve(invocations[0].cwd)).toBe(path.resolve(stubs.path));
    await expect(stubs.argumentsOf('docker')).resolves.toEqual([['inspect', 'api']]);
  });

  it('keeps an argument holding whitespace as one argument', async () => {
    stubs = await StubCommands.create({ docker: [{ stdout: 'x' }] });

    await invoke(stubs, 'docker', ['inspect', '--format', '{{json .Config.Labels}}']);

    await expect(stubs.argumentsOf('docker')).resolves.toEqual([['inspect', '--format', '{{json .Config.Labels}}']]);
  });

  it('starts with no invocations recorded', async () => {
    stubs = await StubCommands.create({ cargo: [{ stdout: 'x' }] });

    await expect(stubs.invocations()).resolves.toEqual([]);
  });

  it('writes a shim the platform can resolve from PATH', async () => {
    stubs = await StubCommands.create({ docker: [{ stdout: 'x' }] });
    const shim = path.join(stubs.path, process.platform === 'win32' ? 'docker.cmd' : 'docker');

    await expect(access(shim, process.platform === 'win32' ? constants.F_OK : constants.X_OK)).resolves.toBeUndefined();
  });

  it('puts its directory ahead of the inherited PATH, so a real tool cannot win', async () => {
    stubs = await StubCommands.create({ docker: [{ stdout: 'x' }] });

    expect(stubs.pathPrepended(`/usr/bin${path.delimiter}/bin`)).toBe(
      `${stubs.path}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    );
  });
});
