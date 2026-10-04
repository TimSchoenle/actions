/**
 * The one question this action asks Docker: how large is the image, uncompressed.
 *
 * Run as an argument vector through `@actions/exec`, never through a shell, and with the reference
 * already validated, so no image name can become a flag or a second command.
 */
import { getExecOutput } from '@actions/exec';

import { DockerError } from './errors.js';

/** What a finished command left behind. */
export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one executable to completion, never throwing on a non-zero exit. */
export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

/** Trailing lines of a failed command's stderr quoted in the error that reports it. */
const REPORTED_STDERR_LINES = 10;

/** Docker prints the size as a plain byte count; 16 digits is past any image that exists. */
const BYTE_COUNT = /^\d{1,16}$/;

/** What `docker image inspect` says when the daemon holds no such image. */
const NO_SUCH_IMAGE = /no such image/i;

/**
 * Binds {@link CommandRunner} to a real process.
 *
 * `ignoreReturnCode` because a non-zero exit is data here: "no such image" is the answer that gets
 * its own message. `silent` because the stderr worth showing is quoted back by whoever reports it.
 */
export function createCommandRunner(): CommandRunner {
  return async (command, args) => {
    const result = await getExecOutput(command, [...args], { ignoreReturnCode: true, silent: true });

    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  };
}

function stderrTail(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((line) => line.trim() !== '');

  return lines.slice(-REPORTED_STDERR_LINES).join('\n');
}

/**
 * Reads `.Size` of a local image: the bytes of its unpacked layers, not its compressed pull size.
 *
 * `--` ends the options, so even a reference that slipped past validation could not be read as one.
 *
 * @throws {DockerError} naming the reference when the image is not loaded, since every later step —
 * Trivy first — would otherwise fail on its own and bury the cause.
 */
export async function inspectImageSize(runCommand: CommandRunner, image: string): Promise<number> {
  const result = await runCommand('docker', ['image', 'inspect', '--format', '{{.Size}}', '--', image]);

  if (result.exitCode !== 0) {
    if (NO_SUCH_IMAGE.test(result.stderr)) {
      throw new DockerError(
        `Image '${image}' is not in the Docker daemon. Build it with 'load: true' before this action runs.`,
      );
    }

    throw new DockerError(
      `'docker image inspect' failed with exit code ${result.exitCode} for '${image}'.\n${stderrTail(result.stderr)}`,
    );
  }

  const output = result.stdout.trim();
  const size = Number(output);

  if (!BYTE_COUNT.test(output) || !Number.isSafeInteger(size)) {
    throw new DockerError(`'docker image inspect' answered '${output.slice(0, 80)}' for '${image}', not a byte count.`);
  }

  return size;
}
