/**
 * The one question this action asks Docker: how large is the image, uncompressed.
 *
 * Every command runs as an argument vector through `@actions/exec`, never through a shell, and with
 * the reference already validated, so no image name can become a flag or a second command.
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

/** Docker prints a size as a plain byte count; 16 digits is past any image that exists. */
const BYTE_COUNT = /^\d{1,16}$/;

/** What Docker says when the daemon holds no such image. */
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

/** A read-only Docker query about one image: its name in messages, and its arguments before `--`. */
interface ImageQuery {
  readonly name: string;
  readonly args: readonly string[];
}

/** `.Size` of the image. */
const INSPECT: ImageQuery = { name: 'docker image inspect', args: ['image', 'inspect', '--format', '{{.Size}}'] };

/** One line per history entry, each its layer's size in bytes; `0` for an entry that adds no layer. */
const HISTORY: ImageQuery = { name: 'docker history', args: ['history', '--human=false', '--format', '{{.Size}}'] };

/**
 * Runs `docker <query> -- <image>` and returns its stdout.
 *
 * `--` ends the options, so even a reference that slipped past validation could not be read as one.
 *
 * @throws {DockerError} naming the reference when the image is not loaded, since every later step —
 * Trivy first — would otherwise fail on its own and bury the cause.
 */
async function queryImage(runCommand: CommandRunner, query: ImageQuery, image: string): Promise<string> {
  const result = await runCommand('docker', [...query.args, '--', image]);

  if (result.exitCode === 0) {
    return result.stdout;
  }

  if (NO_SUCH_IMAGE.test(result.stderr)) {
    throw new DockerError(
      `Image '${image}' is not in the Docker daemon. Build it with 'load: true' before this action runs.`,
    );
  }

  throw new DockerError(
    `'${query.name}' failed with exit code ${result.exitCode} for '${image}'.\n${stderrTail(result.stderr)}`,
  );
}

function parseByteCount(value: string, query: ImageQuery, image: string): number {
  const size = Number(value);

  if (!BYTE_COUNT.test(value) || !Number.isSafeInteger(size)) {
    throw new DockerError(`'${query.name}' answered '${value.slice(0, 80)}' for '${image}', not a byte count.`);
  }

  return size;
}

/**
 * Reads the uncompressed size of a local image: the bytes of its unpacked layers, not its
 * compressed pull size.
 *
 * Docker has no single field for this that holds on both of its image stores:
 *
 * - On the classic (graph driver) store, `.Size` from `docker image inspect` is the unpacked size,
 *   and equals the sum of the layer sizes `docker history` lists.
 * - On the containerd image store (the default from Docker 29, and on GitHub's ubuntu-26.04
 *   runners), `.Size` is the size of the stored content — compressed layers, config and manifest —
 *   while `docker history` lists each layer's unpacked snapshot size.
 *
 * So both are read and the larger is returned. On the containerd store that is the history sum. On
 * the classic store the two agree, except for an image whose history does not cover every layer
 * (some non-BuildKit builders write none), where `.Size` is still complete.
 *
 * `docker image inspect` runs first, so a missing image is refused before history is asked.
 *
 * @throws {DockerError} when the image is not loaded, a command fails, or either answer is not a
 * byte count.
 */
export async function measureImageSize(runCommand: CommandRunner, image: string): Promise<number> {
  const inspected = parseByteCount((await queryImage(runCommand, INSPECT, image)).trim(), INSPECT, image);
  const history = await queryImage(runCommand, HISTORY, image);
  let layers = 0;

  for (const line of history.split(/\r?\n/)) {
    const value = line.trim();

    if (value !== '') {
      layers += parseByteCount(value, HISTORY, image);
    }
  }

  if (!Number.isSafeInteger(layers)) {
    throw new DockerError(`'${HISTORY.name}' layer sizes for '${image}' add up past a byte count.`);
  }

  return Math.max(inspected, layers);
}
