import fs, { type MakeDirectoryOptions, type PathLike, type RmOptions } from 'node:fs';

// System Abstraction for Testability
export const Sys = {
  file: (path: string) => Bun.file(path),
  write: (dest: PathLike, data: string | ArrayBuffer | SharedArrayBuffer | Blob | Bun.BlobPart[]) =>
    Bun.write(dest, data),
  exists: (path: string) => fs.existsSync(path),
  mkdir: (path: string, options?: MakeDirectoryOptions) => fs.promises.mkdir(path, options),
  readdir: (path: string) => fs.readdirSync(path),
  stat: (path: string) => fs.statSync(path),
  rm: (path: string, options?: RmOptions) => fs.promises.rm(path, options),
  exec: async (command: string) => {
    const proc = Bun.spawn(command.split(' '), { stdout: 'pipe' });
    return await new Response(proc.stdout).text();
  },
  /**
   * Runs a command in `cwd` and reports how it ended.
   *
   * Unlike {@link Sys.exec}, the argument vector is passed through unsplit and the exit code and
   * stderr are surfaced, so a failing build can be reported with the compiler's own diagnostics
   * instead of an empty string.
   */
  run: async (command: string[], cwd: string) => {
    const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { exitCode, stdout, stderr };
  },
  glob: (pattern: string) => new Bun.Glob(pattern),
};
