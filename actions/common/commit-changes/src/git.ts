import { exec, getExecOutput } from '@actions/exec';

/** The git operations this action needs, kept minimal so it can be faked in tests. */
export interface Git {
  /**
   * Disables git's tracking of the executable bit.
   *
   * The GraphQL commit API cannot express a mode-only change, so a file whose permissions changed but
   * whose content did not would otherwise be reported as modified and then committed with identical
   * content, producing a no-op diff on every run.
   */
  ignoreFileModeChanges(): Promise<void>;
  /**
   * Returns the raw `git status --porcelain -z` output for the working tree, optionally scoped to the
   * given pathspecs. Untracked files are listed individually and renames are decomposed, so the
   * output is a flat list of `XY <path>` records.
   */
  status(pathspecs?: readonly string[]): Promise<string>;
}

/** Binds {@link Git} to the `git` executable in the workspace. */
export function createGit(): Git {
  return {
    async ignoreFileModeChanges(): Promise<void> {
      await exec('git', ['config', 'core.fileMode', 'false']);
    },

    async status(pathspecs?: readonly string[]): Promise<string> {
      const args = ['status', '--porcelain', '-z', '-uall', '--no-renames'];

      if (pathspecs && pathspecs.length > 0) {
        args.push('--', ...pathspecs);
      }

      const { stdout } = await getExecOutput('git', args, { silent: true });

      return stdout;
    },
  };
}
