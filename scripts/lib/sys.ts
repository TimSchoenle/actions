import fs, { type PathLike, type MakeDirectoryOptions, type RmOptions } from 'node:fs';

// System Abstraction for Testability
export const Sys = {
    file: (path: string) => Bun.file(path),
    write: (dest: PathLike, data: string | ArrayBuffer | SharedArrayBuffer | Blob | Bun.BlobPart[]) => Bun.write(dest, data),
    exists: (path: string) => fs.existsSync(path),
    mkdir: (path: string, options?: MakeDirectoryOptions) => fs.promises.mkdir(path, options),
    readdir: (path: string) => fs.readdirSync(path),
    stat: (path: string) => fs.statSync(path),
    rm: (path: string, options?: RmOptions) => fs.promises.rm(path, options),
};
