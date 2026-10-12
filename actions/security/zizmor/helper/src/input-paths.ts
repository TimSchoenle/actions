/**
 * Resolves the path inputs against the workspace the container will see.
 *
 * zizmor runs with only `$GITHUB_WORKSPACE` mounted, at `/workspace`, so a path outside it does not
 * exist for zizmor at all. A path that does not exist is worse than an error: zizmor reads a missing
 * `owner/repo` as a repository slug and audits that repository over the network instead. Both are
 * refused here, before the image is pulled.
 */
import { stat } from 'node:fs/promises';
import { relative, sep } from 'node:path';

import { quoteForLog, resolveRealWithinWorkspace } from 'actions-util';

import { InvalidInputError } from './errors.js';

/** One path zizmor audits, in the two forms this action needs. */
export interface AuditInput {
  /** The path as zizmor receives it: relative to `/workspace`, with `/` separators. */
  readonly argument: string;
  /** The absolute path on the runner, for the byte order mark scan. */
  readonly absolute: string;
  readonly directory: boolean;
}

/**
 * The path as zizmor receives it.
 *
 * Relative to the workspace root, which is zizmor's working directory in the container, and spelled
 * with `/` because the container is Linux whatever the host is. A name that begins with a dash gets a
 * `./` in front, so `./-` reaches zizmor as a file and not as standard input.
 */
export function containerArgument(workspace: string, absolute: string): string {
  const fromRoot = relative(workspace, absolute).split(sep).join('/');

  if (fromRoot === '') {
    return '.';
  }

  return fromRoot.startsWith('-') ? `./${fromRoot}` : fromRoot;
}

/** `stat` that answers undefined for a path that does not exist. */
async function statIfPresent(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;

    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined;
    }

    throw error;
  }
}

/**
 * Resolves every `inputs` line to a file or a directory inside the workspace.
 *
 * Containment is checked through symbolic links, so a committed link to `/etc` is refused as firmly
 * as `../..`. A link that stays inside the workspace is followed.
 *
 * @throws {@link InvalidInputError} for a path that does not exist or is neither a file nor a
 * directory, and `UnsafePathError` for one that leaves the workspace.
 */
export async function resolveAuditInputs(paths: readonly string[], workspace: string): Promise<AuditInput[]> {
  const resolved: AuditInput[] = [];

  for (const path of paths) {
    const absolute = await resolveRealWithinWorkspace(path, workspace, 'inputs');
    const stats = await statIfPresent(absolute);

    if (stats === undefined) {
      throw new InvalidInputError(
        'inputs',
        `${quoteForLog(path)} does not exist in the workspace. zizmor would read a missing path shaped like ` +
          'owner/repo as a repository to fetch, so it is refused here.',
      );
    }

    if (!stats.isFile() && !stats.isDirectory()) {
      throw new InvalidInputError('inputs', `${quoteForLog(path)} is neither a file nor a directory.`);
    }

    const argument = containerArgument(workspace, absolute);

    if (!resolved.some((input) => input.argument === argument)) {
      resolved.push({ argument, absolute, directory: stats.isDirectory() });
    }
  }

  return resolved;
}

/**
 * Resolves the `config` input to a file inside the workspace, as zizmor receives it.
 *
 * @throws {@link InvalidInputError} for a path that is not an existing file, and `UnsafePathError` for
 * one that leaves the workspace.
 */
export async function resolveConfigPath(path: string, workspace: string): Promise<string> {
  const absolute = await resolveRealWithinWorkspace(path, workspace, 'config');
  const stats = await statIfPresent(absolute);

  if (stats === undefined || !stats.isFile()) {
    throw new InvalidInputError('config', `${quoteForLog(path)} is not a file in the workspace.`);
  }

  return containerArgument(workspace, absolute);
}
