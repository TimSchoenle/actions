/**
 * The one seam between this action and the two executables it drives.
 *
 * Everything that decides a verdict — which arguments cargo is given, how a label set is compared,
 * what counts as a contract — is a pure function over the strings on either side of this interface.
 * That is what lets the whole of it be unit-tested without a Rust toolchain or a Docker daemon on
 * the machine, and what lets the end-to-end cases assert on the *argument vector* rather than on
 * whether a build happened to succeed.
 */
import { getExecOutput } from '@actions/exec';

/** What a finished command left behind. */
export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one executable to completion, never throwing on a non-zero exit. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string },
) => Promise<CommandResult>;

/** Trailing lines of a failed command's stderr quoted in the error that reports it. */
const REPORTED_STDERR_LINES = 20;

/**
 * Binds {@link CommandRunner} to a real process.
 *
 * `ignoreReturnCode` because a non-zero exit is data here, not an exception: a `docker cp` that
 * cannot find the file is the answer to the question being asked. `silent` because cargo writes its
 * build progress to stderr and this action's log is about the comparison, not about the build —
 * whatever mattered is quoted back by whoever reports the failure.
 *
 * The whitespace guard is not decoration. `@actions/exec` re-parses its first argument as a command
 * *line*, so a tool path containing a space silently becomes a different executable plus a stray
 * argument. Only the two constants in this action are ever passed here, and the guard is what keeps
 * that true rather than merely currently so.
 */
export function createCommandRunner(): CommandRunner {
  return async (command, args, options) => {
    if (/\s/.test(command)) {
      throw new Error(`'${command}' is not a bare executable name; @actions/exec would re-split it into arguments.`);
    }

    const result = await getExecOutput(command, [...args], {
      cwd: options.cwd,
      ignoreReturnCode: true,
      silent: true,
    });

    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  };
}

/** Renders the tail of a failed command's stderr, for the error that reports it. */
export function stderrTail(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((line) => line.trim() !== '');

  return lines.slice(-REPORTED_STDERR_LINES).join('\n');
}
