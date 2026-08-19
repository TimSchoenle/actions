/**
 * What the built image itself says, read through the `docker` CLI.
 *
 * Two questions only: what labels does the config blob carry, and is there a file where the label
 * says the contract is. Both are asked of an image that already exists locally — this action runs
 * after the build and before the push, where a failure costs a retry instead of a release.
 *
 * The image reference is validated against the reference grammar before it reaches here (see
 * `image-reference.ts`), which is what makes it safe to pass as a bare argument: `docker` would read
 * a leading `-` as a flag, and no amount of care at this layer would undo that.
 */
import { stderrTail } from './command.js';
import { GENERATED_LABEL_FORMAT } from './docker-format.js';
import { DockerError } from './errors.js';

import type { CommandRunner } from './command.js';

/** The executable every call here goes through. */
export const DOCKER = 'docker';

/** A container id as `docker create` prints it, and nothing else may become an argument. */
const CONTAINER_ID = /^[0-9a-f]{12,64}$/;

/** Reads what a built image carries. */
export interface ImageInspector {
  /** The image's `.Config.Labels`, parsed. Shape is deliberately not asserted here. */
  inspectLabels(reference: string): Promise<unknown>;
  /**
   * Copies one path out of the image.
   *
   * @returns whether the path existed. Absence is an answer to the question being asked, not a
   * failure of the tool, so it is reported rather than thrown.
   */
  copyOut(reference: string, pathInImage: string, destination: string): Promise<boolean>;
}

function failed(what: string, result: { exitCode: number; stderr: string }): DockerError {
  const detail = stderrTail(result.stderr);

  return new DockerError(`${what} exited with ${result.exitCode}.${detail === '' ? '' : `\n${detail}`}`);
}

/** The last non-empty line of a command's stdout, which is where an id ends up. */
function lastLine(stdout: string): string {
  return (
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .at(-1) ?? ''
  );
}

/** Binds {@link ImageInspector} to the `docker` CLI. */
export function createDockerInspector(run: CommandRunner): ImageInspector {
  async function create(reference: string): Promise<string> {
    const result = await run(DOCKER, ['create', reference], {});

    if (result.exitCode !== 0) {
      throw failed(`\`docker create ${reference}\``, result);
    }

    const container = lastLine(result.stdout);

    // Validated because it becomes an argument to the next two calls. `docker create` printing
    // something that is not an id means the command did something other than what is assumed here,
    // and passing it on would be building an argument out of an unread answer.
    if (!CONTAINER_ID.test(container)) {
      throw new DockerError(`\`docker create ${reference}\` did not print a container id.`);
    }

    return container;
  }

  return {
    async inspectLabels(reference: string): Promise<unknown> {
      const result = await run(DOCKER, ['inspect', '--format', GENERATED_LABEL_FORMAT, reference], {});

      if (result.exitCode !== 0) {
        throw failed(`\`docker inspect ${reference}\``, result);
      }

      try {
        return JSON.parse(result.stdout) as unknown;
      } catch (error) {
        throw new DockerError(`\`docker inspect ${reference}\` did not answer with JSON.`, error);
      }
    },

    async copyOut(reference: string, pathInImage: string, destination: string): Promise<boolean> {
      const container = await create(reference);

      try {
        const result = await run(DOCKER, ['cp', `${container}:${pathInImage}`, destination], {});

        return result.exitCode === 0;
      } finally {
        // Best effort, and deliberately so: a container that outlives the step is a leak on a
        // throwaway runner, while a failure to remove it must not mask the verdict it was created
        // to produce.
        await run(DOCKER, ['rm', '--force', container], {}).catch(() => undefined);
      }
    },
  };
}
