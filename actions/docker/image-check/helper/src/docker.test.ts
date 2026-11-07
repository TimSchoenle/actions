import { describe, expect, it } from 'vitest';

import { measureImageSize } from './docker.js';
import { DockerError } from './errors.js';

import type { CommandResult, CommandRunner } from './docker.js';

const INSPECT = ['docker', 'image', 'inspect', '--format', '{{.Size}}', '--', 'app:test'];
const HISTORY = ['docker', 'history', '--human=false', '--format', '{{.Size}}', '--', 'app:test'];

interface Answers {
  inspect?: Partial<CommandResult>;
  history?: Partial<CommandResult>;
}

/** Answers each query by its subcommand; an unexpected command fails the case. */
function runner(answers: Answers, calls: string[][] = []): CommandRunner {
  return (command, args) => {
    calls.push([command, ...args]);
    const answer = args[0] === 'image' ? answers.inspect : args[0] === 'history' ? answers.history : undefined;

    if (answer === undefined) {
      return Promise.reject(new Error(`unexpected command: ${[command, ...args].join(' ')}`));
    }

    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', ...answer });
  };
}

describe('measureImageSize', () => {
  it('asks inspect, then history, each with the reference after the end of options', async () => {
    const calls: string[][] = [];

    await measureImageSize(runner({ inspect: { stdout: '10\n' }, history: { stdout: '10\n' } }, calls), 'app:test');

    expect(calls).toEqual([INSPECT, HISTORY]);
  });

  it('keeps .Size on the classic store, where the history sum agrees with it', async () => {
    const answers = { inspect: { stdout: '91645132\n' }, history: { stdout: '0\n91645000\n0\n132\n' } };

    await expect(measureImageSize(runner(answers), 'app:test')).resolves.toBe(91_645_132);
  });

  it('takes the history sum on the containerd store, where .Size is the compressed content', async () => {
    const answers = { inspect: { stdout: '3988\n' }, history: { stdout: '2101248\r\n0\r\n4096\r\n' } };

    await expect(measureImageSize(runner(answers), 'app:test')).resolves.toBe(2_105_344);
  });

  it('keeps .Size when the history covers no layer', async () => {
    const answers = { inspect: { stdout: '91645132\n' }, history: { stdout: '' } };

    await expect(measureImageSize(runner(answers), 'app:test')).resolves.toBe(91_645_132);
  });

  it('names the reference when the image was never loaded, and asks nothing further', async () => {
    const calls: string[][] = [];
    const missing = { exitCode: 1, stderr: 'Error response from daemon: No such image: app:test\n' };

    await expect(measureImageSize(runner({ inspect: missing }, calls), 'app:test')).rejects.toThrow(
      "Image 'app:test' is not in the Docker daemon. Build it with 'load: true' before this action runs.",
    );
    expect(calls).toEqual([INSPECT]);
  });

  it('quotes stderr for any other inspect failure', async () => {
    const down = { exitCode: 1, stderr: 'Cannot connect to the Docker daemon\n' };

    await expect(measureImageSize(runner({ inspect: down }), 'app:test')).rejects.toThrow(
      /'docker image inspect' failed with exit code 1.*\nCannot connect/s,
    );
  });

  it('quotes stderr when history fails, naming history', async () => {
    const answers = {
      inspect: { stdout: '3988\n' },
      history: { exitCode: 1, stderr: 'Error response from daemon: failed to get usage: not found\n' },
    };

    await expect(measureImageSize(runner(answers), 'app:test')).rejects.toThrow(
      /'docker history' failed with exit code 1.*\nError response from daemon: failed to get usage/s,
    );
  });

  it.each(['', '<no value>', '-1', '1.5', '99999999999999999'])('refuses %j as the inspected size', async (stdout) => {
    await expect(
      measureImageSize(runner({ inspect: { stdout }, history: { stdout: '1\n' } }), 'app:test'),
    ).rejects.toThrow(DockerError);
  });

  it.each(['12MB\n', '1\n-1\n', '1.5\n'])('refuses a history line in %j', async (stdout) => {
    await expect(
      measureImageSize(runner({ inspect: { stdout: '1\n' }, history: { stdout } }), 'app:test'),
    ).rejects.toThrow(/'docker history' answered/);
  });

  it('refuses history sizes that add up past a safe integer', async () => {
    const history = { stdout: '9000000000000000\n9000000000000000\n' };

    await expect(measureImageSize(runner({ inspect: { stdout: '1\n' }, history }), 'app:test')).rejects.toThrow(
      /add up past a byte count/,
    );
  });
});
