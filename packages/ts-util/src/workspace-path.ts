/**
 * The one question every action taking a path input has to answer: does it stay in the checkout?
 *
 * A `node20` action runs with the workspace as its working directory and with a token in its
 * environment, so a path input that escapes is an arbitrary read or write on the runner — `../`
 * reaches the rest of the job's disk, and an absolute path reaches everything the runner user can.
 * Neither has a legitimate use here: every one of these actions operates on the checked-out
 * repository, and a workflow that means a file outside it has taken a wrong turn.
 */
import { isAbsolute, relative, resolve } from 'node:path';

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

/** The workspace an action resolves its path inputs against, as the runner sets it. */
export function workspaceRoot(): string {
  return process.env['GITHUB_WORKSPACE'] ?? process.cwd();
}
