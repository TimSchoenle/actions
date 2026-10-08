/**
 * The one question every action taking a path input has to answer: does it stay in the checkout?
 *
 * A `node20` action runs with the workspace as its working directory and with a token in its
 * environment, so a path input that escapes is an arbitrary read or write on the runner — `../`
 * reaches the rest of the job's disk, and an absolute path reaches everything the runner user can.
 * Neither has a legitimate use here: every one of these actions operates on the checked-out
 * repository, and a workflow that means a file outside it has taken a wrong turn.
 */
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { quoteForLog } from './log.js';

/** Raised when a path input escapes, or could escape, the workspace it is resolved against. */
export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

/** Matches a Windows drive prefix, which `isAbsolute` does not recognise when running on POSIX. */
const DRIVE_PREFIX = /^[A-Za-z]:/;

/**
 * Resolves `value` beneath `workspace`, refusing anything that leaves it.
 *
 * Three checks rather than one, and deliberately so:
 *
 * - **Syntactic**, on the input as written, because it produces the error a caller can act on: "you
 *   passed an absolute path" beats "the resolved path is outside the workspace".
 * - **On the resolved result**, because it is the check that actually holds. A syntactic rule only
 *   rejects the escapes it thought of; `relative()` rejects the ones it did not.
 * - **Cross-platform**, because `path` is not. A POSIX `resolve` treats `C:/Windows` as a relative
 *   directory named `C:` and joins it happily, so a Linux runner would accept a path that means
 *   something entirely different to the Windows one running the same workflow.
 *
 * @param inputName the action input being validated, named in every message so the workflow author
 * knows which of several paths to fix.
 * @returns the absolute resolved path, for callers that need it.
 * @throws {UnsafePathError} if the value is empty, absolute, or resolves outside the workspace.
 */
export function resolveWithinWorkspace(value: string, workspace: string, inputName: string): string {
  const trimmed = value.trim();

  if (trimmed === '') {
    throw new UnsafePathError(`${inputName} must not be empty`);
  }

  if (isAbsolute(trimmed) || DRIVE_PREFIX.test(trimmed) || trimmed.startsWith('\\\\')) {
    throw new UnsafePathError(`${inputName} must be relative to the repository, got ${quoteForLog(value)}`);
  }

  if (trimmed.split(/[/\\]/).includes('..')) {
    throw new UnsafePathError(`${inputName} must not traverse upwards, got ${quoteForLog(value)}`);
  }

  const root = resolve(workspace);
  const resolved = resolve(root, trimmed);
  const fromRoot = relative(root, resolved);

  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new UnsafePathError(`${inputName} resolves outside the workspace: ${quoteForLog(value)}`);
  }

  return resolved;
}

/** `realpath` of the deepest part of `target` that exists, with the missing remainder re-appended. */
async function realpathOfExisting(target: string, value: string, inputName: string): Promise<string> {
  const missing: string[] = [];
  let current = target;

  for (;;) {
    try {
      await lstat(current);
    } catch (error) {
      if (!isMissing(error) || dirname(current) === current) {
        throw error;
      }

      missing.unshift(basename(current));
      current = dirname(current);
      continue;
    }

    try {
      return join(await realpath(current), ...missing);
    } catch (error) {
      // `lstat` found an entry that `realpath` cannot follow: a link to nothing. Writing through it
      // would create its target, wherever that is, so it is refused rather than reasoned about.
      if (isMissing(error)) {
        throw new UnsafePathError(
          `${inputName} is a symbolic link to a path that does not exist: ${quoteForLog(value)}`,
        );
      }

      throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;

  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * {@link resolveWithinWorkspace}, then the same question asked of where the path *really* lands.
 *
 * The lexical check reads the path as written, and a symbolic link is invisible to it: a pull
 * request can commit `README.hbs` as a link to `/proc/self/environ`, and `README.hbs` is a spotless
 * relative path. Git records the link and checkout materialises it, so an action that only checked
 * the spelling reads the step's environment — token included — or writes through the link onto
 * whatever it names. This resolves every link on the way, the workspace's own included (a runner's
 * temp directory may itself sit behind one), and applies the containment rule to the result.
 *
 * Links that stay inside the workspace are followed as before: the rule is about where a path lands,
 * not about links as such. A path that does not exist yet — an output about to be written — is
 * judged by its deepest existing ancestor, since that is where the write would be redirected.
 *
 * Checked once, before use. A workspace the action's own process does not control could swap a
 * directory for a link in between, but the threat here is content committed to a repository, and
 * that is fixed by the time the step runs.
 *
 * @returns the absolute resolved path, as {@link resolveWithinWorkspace} does — unrewritten, so
 * error messages and reported paths keep naming what the caller wrote.
 * @throws {UnsafePathError} on anything {@link resolveWithinWorkspace} rejects, on a path that a link
 * carries outside the workspace, and on a dangling link.
 */
export async function resolveRealWithinWorkspace(value: string, workspace: string, inputName: string): Promise<string> {
  const resolved = resolveWithinWorkspace(value, workspace, inputName);
  const realRoot = await realpath(resolve(workspace));
  const fromRoot = relative(realRoot, await realpathOfExisting(resolved, value, inputName));

  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new UnsafePathError(
      `${inputName} resolves outside the workspace through a symbolic link: ${quoteForLog(value)}`,
    );
  }

  return resolved;
}

/** The workspace an action resolves its path inputs against, as the runner sets it. */
export function workspaceRoot(): string {
  return process.env['GITHUB_WORKSPACE'] ?? process.cwd();
}
