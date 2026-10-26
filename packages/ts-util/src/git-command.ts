import { execFile } from 'node:child_process';

/** Raised when `git` exits non-zero, cannot be started, or writes more than the caller allowed. */
export class GitCommandError extends Error {
  /** The arguments `git` was started with, for a message that names the failing command. */
  readonly args: readonly string[];
  /** Whatever `git` wrote to standard error, trimmed. Empty when it could not be started. */
  readonly stderr: string;
  /** True when the command was stopped because its output exceeded `maxOutputBytes`. */
  readonly outputLimitExceeded: boolean;

  constructor(args: readonly string[], stderr: string, outputLimitExceeded: boolean, cause?: unknown) {
    const detail = outputLimitExceeded ? 'its output exceeded the size limit' : stderr || 'it exited non-zero';
    super(`git ${args[0] ?? ''} failed: ${detail}`, { cause });
    this.name = 'GitCommandError';
    this.args = args;
    this.stderr = stderr;
    this.outputLimitExceeded = outputLimitExceeded;
  }
}

/** How {@link runGit} starts `git`. */
export interface GitCommandOptions {
  /** Working directory, normally the checked-out repository. */
  cwd: string;
  /**
   * Extra environment, merged over the inherited one. Used for `GIT_INDEX_FILE`, which is how the
   * patch actions stage into a throwaway index instead of the checkout's own.
   */
  env?: Readonly<Record<string, string>>;
  /**
   * Ceiling on standard output, in bytes. `git` is stopped once it is passed, so an oversized diff
   * fails with {@link GitCommandError.outputLimitExceeded} instead of being buffered whole.
   */
  maxOutputBytes?: number;
}

/** Default output ceiling: generous for plumbing output, small enough to never exhaust a runner. */
export const DEFAULT_GIT_OUTPUT_LIMIT = 64 * 1024 * 1024;

/** The error code Node reports when a child's output passes `maxBuffer`. */
const MAX_BUFFER_CODE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

/**
 * Runs `git` with `args` and resolves to its standard output as raw bytes.
 *
 * Bytes rather than a string because the callers handle diffs and blobs: a file that is not valid
 * UTF-8 has to reach a patch or a commit unchanged, and decoding it on the way would replace every
 * invalid sequence with U+FFFD. Callers that read text decode it themselves.
 *
 * `git` is started without a shell, so no argument is ever interpreted, and with prompts disabled,
 * so a missing credential fails the command instead of waiting for input that never comes.
 *
 * @throws {GitCommandError} when `git` cannot be started, exits non-zero, or exceeds the limit.
 */
export function runGit(args: readonly string[], options: GitCommandOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd: options.cwd,
        encoding: 'buffer',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
        maxBuffer: options.maxOutputBytes ?? DEFAULT_GIT_OUTPUT_LIMIT,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const limited = (error as NodeJS.ErrnoException).code === MAX_BUFFER_CODE;
          reject(new GitCommandError(args, stderr.toString('utf8').trim(), limited, error));
          return;
        }

        resolve(stdout);
      },
    );
  });
}

/** {@link runGit}, decoded as UTF-8 with surrounding whitespace removed, for one-line answers. */
export async function runGitText(args: readonly string[], options: GitCommandOptions): Promise<string> {
  return (await runGit(args, options)).toString('utf8').trim();
}
