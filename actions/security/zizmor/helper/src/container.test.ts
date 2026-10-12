import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exec } from '@actions/exec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { csvField, describeExit, dockerArguments, LineRelay, relayLine, runContainer } from './container.js';

import type { ContainerRun } from './container.js';
import type { ExecOptions } from '@actions/exec';

vi.mock('@actions/exec', () => ({ exec: vi.fn() }));

const IMAGE = `ghcr.io/zizmorcore/zizmor:1.30.1@sha256:${'a'.repeat(64)}`;

describe('dockerArguments', () => {
  it('starts a read-only, unprivileged container with the workspace mounted read-only', () => {
    expect(
      dockerArguments({ image: IMAGE, workspace: '/home/runner/work/r/r', zizmorArguments: ['--', '.'], online: true }),
    ).toEqual([
      'run',
      '--rm',
      '--read-only',
      '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user=65534:65534',
      '--mount=type=bind,source=/home/runner/work/r/r,target=/workspace,readonly',
      '--workdir=/workspace',
      '--env=GH_TOKEN',
      IMAGE,
      '--',
      '.',
    ]);
  });

  it('gives an offline run no network and no token', () => {
    const args = dockerArguments({ image: IMAGE, workspace: '/w', zizmorArguments: [], online: false });

    expect(args).toContain('--network=none');
    expect(args.join(' ')).not.toContain('GH_TOKEN');
  });

  it('quotes a workspace path that would otherwise end the mount field early', () => {
    const args = dockerArguments({
      image: IMAGE,
      workspace: '/w/a,readonly=false',
      zizmorArguments: [],
      online: false,
    });

    expect(args).toContain('--mount=type=bind,"source=/w/a,readonly=false",target=/workspace,readonly');
  });
});

describe('csvField', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['a"b', '"a""b"'],
    ['a\nb', '"a\nb"'],
  ])('%j becomes %j', (field, expected) => {
    expect(csvField(field)).toBe(expected);
  });
});

describe('relayLine', () => {
  it('prefixes a visible character, so the runner never sees :: at the start', () => {
    expect(relayLine('::error::forged')).toBe('| ::error::forged');
    expect(relayLine('   ::add-mask::x').trimStart().startsWith('::')).toBe(false);
  });

  it('escapes control characters and keeps tabs', () => {
    expect(relayLine('a\u001B[31mb\tc\u2028d\u0085')).toBe('| a\\u001b[31mb\tc\\u2028d\\u0085');
  });
});

describe('LineRelay', () => {
  function relayed(chunks: readonly string[]): string[] {
    const lines: string[] = [];
    const relay = new LineRelay((line) => lines.push(line));

    for (const chunk of chunks) {
      relay.push(chunk);
    }

    relay.flush();

    return lines;
  }

  it('splits on \\n, \\r\\n and a lone \\r, as the runner does', () => {
    expect(relayed(['a\nb\r\nc\r::error::x\n'])).toEqual(['| a', '| b', '| c', '| ::error::x']);
  });

  it('joins a line split across chunks', () => {
    expect(relayed(['WARN fail', 'ed to parse\n'])).toEqual(['| WARN failed to parse']);
  });

  it('does not invent an empty line when \\r\\n is split across chunks', () => {
    expect(relayed(['a\r', '\nb'])).toEqual(['| a', '| b']);
  });

  it('treats a \\r at the very end as a line break', () => {
    expect(relayed(['a\r'])).toEqual(['| a']);
  });

  it('flushes a last line without a break, and nothing for an empty stream', () => {
    expect(relayed(['tail'])).toEqual(['| tail']);
    expect(relayed([])).toEqual([]);
  });
});

describe('runContainer', () => {
  const RUN: ContainerRun = { image: IMAGE, workspace: '/w', zizmorArguments: ['--', '.'], online: true };

  let directory: string;
  let sarifFile: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'zizmor-container-'));
    sarifFile = join(directory, 'results.sarif');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  /** docker writes `stdout` and `stderr` chunk by chunk through the listeners, then exits. */
  function dockerAnswers(exitCode: number, stdout: readonly string[], stderr: readonly string[]): void {
    vi.mocked(exec).mockImplementation(async (_command, _args, options?: ExecOptions) => {
      for (const chunk of stdout) {
        options?.listeners?.stdout?.(Buffer.from(chunk));
      }

      for (const chunk of stderr) {
        options?.listeners?.stderr?.(Buffer.from(chunk));
      }

      return exitCode;
    });
  }

  function execOptions(): ExecOptions | undefined {
    return vi.mocked(exec).mock.calls[0]?.[2];
  }

  it('streams stdout into the SARIF file and relays stderr line by line, neutralised', async () => {
    dockerAnswers(0, ['{"version":', '"2.1.0"}'], ['WARN a\n::error::', 'forged\ntail']);
    const lines: string[] = [];

    await expect(runContainer(RUN, sarifFile, 'token', (line) => lines.push(line))).resolves.toEqual({ exitCode: 0 });

    expect(await readFile(sarifFile, 'utf8')).toBe('{"version":"2.1.0"}');
    expect(lines).toEqual(['| WARN a', '| ::error::forged', '| tail']);
    expect(vi.mocked(exec).mock.calls[0]?.slice(0, 2)).toEqual(['docker', dockerArguments(RUN)]);
    expect(execOptions()).toMatchObject({ ignoreReturnCode: true, silent: true });
  });

  it.skipIf(process.platform === 'win32')('creates the SARIF file readable by its owner only', async () => {
    dockerAnswers(0, [], []);

    await runContainer(RUN, sarifFile, undefined, () => undefined);

    expect((await stat(sarifFile)).mode & 0o777).toBe(0o600);
  });

  it('returns a non-zero exit code rather than throwing', async () => {
    dockerAnswers(125, [], ['Unable to find image\n']);

    await expect(runContainer(RUN, sarifFile, 'token', () => undefined)).resolves.toEqual({ exitCode: 125 });
  });

  it('hands an online run the token as GH_TOKEN and the rest of the environment unchanged', async () => {
    vi.stubEnv('ZIZMOR_TEST_KEPT', 'kept');
    dockerAnswers(0, [], []);

    await runContainer(RUN, sarifFile, 'token', () => undefined);

    expect(execOptions()?.env).toMatchObject({ GH_TOKEN: 'token', ZIZMOR_TEST_KEPT: 'kept' });
  });

  it('drops an inherited GH_TOKEN from an offline run', async () => {
    vi.stubEnv('GH_TOKEN', 'inherited');
    dockerAnswers(0, [], []);

    await runContainer({ ...RUN, online: false }, sarifFile, 'token', () => undefined);

    expect(execOptions()?.env).not.toHaveProperty('GH_TOKEN');
  });

  it('replaces an inherited GH_TOKEN with the token it was given', async () => {
    vi.stubEnv('GH_TOKEN', 'inherited');
    dockerAnswers(0, [], []);

    await runContainer(RUN, sarifFile, 'token', () => undefined);

    expect(execOptions()?.env?.['GH_TOKEN']).toBe('token');
  });

  it('explains a docker that cannot be started, and still closes the SARIF file', async () => {
    vi.mocked(exec).mockRejectedValue(new Error('Unable to locate executable file: docker'));

    await expect(runContainer(RUN, sarifFile, 'token', () => undefined)).rejects.toThrow('docker could not be started');
    await expect(rm(sarifFile)).resolves.toBeUndefined();
  });

  it('refuses to write over a SARIF file that already exists, before docker starts', async () => {
    await writeFile(sarifFile, 'planted');
    dockerAnswers(0, ['{}'], []);

    await expect(runContainer(RUN, sarifFile, 'token', () => undefined)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(exec).not.toHaveBeenCalled();
    expect(await readFile(sarifFile, 'utf8')).toBe('planted');
  });
});

describe('describeExit', () => {
  it.each([
    [1, 'could not load an input'],
    [2, 'rejected its arguments'],
    [3, 'collected no inputs'],
    [125, 'ghcr.io:443'],
    [127, 'could not be run'],
    [14, 'zizmor exited with 14.'],
  ])('explains %i', (code, expected) => {
    expect(describeExit(code)).toContain(expected);
  });
});
