import { describe, expect, it } from 'vitest';

import { inspectImageSize } from './docker.js';
import { DockerError } from './errors.js';

import type { CommandResult, CommandRunner } from './docker.js';

function runner(result: Partial<CommandResult>, calls: string[][] = []): CommandRunner {
  return (command, args) => {
    calls.push([command, ...args]);

    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', ...result });
  };
}

describe('inspectImageSize', () => {
  it('asks for .Size with the reference after the end of options', async () => {
    const calls: string[][] = [];

    await expect(inspectImageSize(runner({ stdout: '91645132\n' }, calls), 'app:test')).resolves.toBe(91_645_132);
    expect(calls).toEqual([['docker', 'image', 'inspect', '--format', '{{.Size}}', '--', 'app:test']]);
  });

  it('names the reference when the image was never loaded', async () => {
    const missing = runner({ exitCode: 1, stderr: 'Error response from daemon: No such image: app:test\n' });

    await expect(inspectImageSize(missing, 'app:test')).rejects.toThrow(
      "Image 'app:test' is not in the Docker daemon. Build it with 'load: true' before this action runs.",
    );
  });

  it('quotes stderr for any other failure', async () => {
    const down = runner({ exitCode: 1, stderr: 'Cannot connect to the Docker daemon\n' });

    await expect(inspectImageSize(down, 'app:test')).rejects.toThrow(/exit code 1.*\nCannot connect/s);
  });

  it.each(['', '<no value>', '-1', '1.5', '99999999999999999'])('refuses %j as a size', async (stdout) => {
    await expect(inspectImageSize(runner({ stdout }), 'app:test')).rejects.toThrow(DockerError);
  });
});
