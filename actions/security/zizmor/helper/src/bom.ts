/**
 * Finds every input that starts with a UTF-8 byte order mark, before zizmor runs.
 *
 * zizmor 1.30.1 reads `EF BB BF` as the start of a second YAML document and fails to parse the file.
 * Without `--strict-collection` it logs a warning that does not name the file, drops it and exits 0.
 * With it, zizmor stops at the first such file. Neither tells a repository with five of them where
 * the five are, so this scan reads the first three bytes of every file zizmor would collect and
 * annotates each one.
 *
 * "Would collect" is the point: a BOM in a `docker-compose.yml` breaks nothing zizmor does, and
 * failing a job over it would be a false alarm. The rules below were measured against zizmor 1.30.1
 * and are kept narrow on purpose. A file this scan misses is still caught by zizmor's own strict
 * collection, only without the full list.
 */
import { spawn } from 'node:child_process';
import { open, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { AuditInput } from './input-paths.js';

const BYTE_ORDER_MARK = [0xef, 0xbb, 0xbf] as const;

const YAML_EXTENSIONS = ['.yml', '.yaml'] as const;

/** Directory names never descended into: git's own store holds nothing zizmor audits. */
const SKIPPED_DIRECTORIES = new Set(['.git']);

/**
 * Whether zizmor 1.30.1 collects this file from a directory input and fails on a BOM in it.
 *
 * Measured, not taken from documentation. Names are case-sensitive (`Action.yml` and `w.YML` are not
 * collected) and a workflow must sit directly in a `.github/workflows` directory, at any depth of the
 * tree. Inside a git repository, git's ignore rules also apply; see {@link IgnoreFilter}. A BOM in `.pre-commit-config.yaml` is collected and parsed without complaint, so it is not
 * flagged.
 *
 * @param segments - the path relative to the walked directory, split on the separator.
 */
export function isCollectedAndBomSensitive(segments: readonly string[]): boolean {
  const name = segments.at(-1) ?? '';
  const parent = segments.at(-2);
  const grandparent = segments.at(-3);
  const yaml = YAML_EXTENSIONS.some((extension) => name.endsWith(extension));

  if (!yaml) {
    return false;
  }

  if (name === 'action.yml' || name === 'action.yaml') {
    return true;
  }

  if (name === '.pre-commit-hooks.yml' || name === '.pre-commit-hooks.yaml') {
    return true;
  }

  if (parent === '.github' && (name === 'dependabot.yml' || name === 'dependabot.yaml')) {
    return true;
  }

  return parent === 'workflows' && grandparent === '.github';
}

/** Whether a file's first three bytes are the UTF-8 byte order mark. */
export async function startsWithByteOrderMark(path: string): Promise<boolean> {
  const handle = await open(path, 'r');

  try {
    const buffer = Buffer.alloc(BYTE_ORDER_MARK.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);

    return bytesRead === BYTE_ORDER_MARK.length && BYTE_ORDER_MARK.every((byte, index) => buffer[index] === byte);
  } finally {
    await handle.close();
  }
}

/**
 * Every file under `root` that {@link isCollectedAndBomSensitive} accepts, sorted.
 *
 * The rules are applied to the path relative to the workspace, not to `root`: zizmor matches the
 * path as it walked it, so an input of `.github/workflows` still collects the workflows in it.
 *
 * Symbolic links are neither followed nor returned: `readdir`'s `Dirent` reports a link as a link,
 * and zizmor's walker does not follow one either. Following one here would read outside the
 * workspace on behalf of a link a pull request committed.
 */
export async function collectCandidates(root: string, workspace: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];

  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          pending.push(path);
        }
      } else if (entry.isFile() && isCollectedAndBomSensitive(relative(workspace, path).split(sep))) {
        found.push(path);
      }
    }
  }

  return found.sort();
}

/**
 * Answers which of the given workspace-relative paths git ignores.
 *
 * zizmor walks a directory input with the `ignore` crate, which honours `.gitignore`, the
 * repository's `info/exclude` and the global excludes file by pattern alone, whether or not a path is
 * tracked. `git check-ignore --no-index` answers the same question by the same rules.
 */
export type IgnoreFilter = (workspace: string, paths: readonly string[]) => Promise<Set<string>>;

/** What a finished command left behind: its exit code (null when a signal ended it) and stdout. */
interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
}

/**
 * Runs a command with `input` on its standard input, tolerating a command that exits unread.
 *
 * `@actions/exec` cannot be used here. A command that exits before reading its input closes the
 * pipe, the pending write then fails with `EPIPE`, and that error is emitted on a stream nothing in
 * `@actions/exec` listens to, so node exits on an uncaught exception. Whether the write loses that
 * race depends on the platform's pipes: Linux loses it, Windows has never been seen to.
 *
 * @returns undefined when the command could not be started at all, such as with no git on `PATH`.
 */
export async function runWithInput(
  command: string,
  args: readonly string[],
  input: Buffer,
  cwd: string,
): Promise<CommandResult | undefined> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const chunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    // The exit code says what happened; a write the command never read is not an error of its own.
    child.stdin.on('error', () => undefined);
    child.on('error', () => resolvePromise(undefined));
    child.on('close', (exitCode) => resolvePromise({ exitCode, stdout: Buffer.concat(chunks).toString('utf8') }));
    child.stdin.end(input);
  });
}

/**
 * {@link IgnoreFilter} backed by `git check-ignore`.
 *
 * Outside a repository, or when git refuses one (a workspace owned by another user), nothing is
 * reported as ignored. That matches zizmor, which applies `.gitignore` only inside a repository, and
 * errs towards reporting a BOM rather than hiding one. Git refuses either case before it reads the
 * paths, which is why it runs through {@link runWithInput}.
 *
 * One divergence remains. An input that itself lies inside an ignored directory is walked by zizmor,
 * which matches each entry against the patterns on its own, while git counts the ignored parent. Such
 * a file is not annotated here, and zizmor's strict collection still fails on it.
 */
export const gitIgnoreFilter: IgnoreFilter = async (workspace, paths) => {
  if (paths.length === 0) {
    return new Set();
  }

  const result = await runWithInput(
    'git',
    ['check-ignore', '--no-index', '-z', '--stdin'],
    Buffer.from(paths.map((path) => `${path}\0`).join(''), 'utf8'),
    workspace,
  );

  // No git on PATH: nothing can be ignored by rules nobody can read. Exit 0: some paths are ignored.
  // 1: none are. Anything else is git declining to answer.
  if (result?.exitCode !== 0) {
    return new Set();
  }

  return new Set(result.stdout.split('\0').filter((path) => path !== ''));
};

/**
 * Every audit input that starts with a byte order mark, relative to the workspace with `/`
 * separators, which is what an annotation's `file` property expects.
 *
 * A file named directly is checked whatever its name, because zizmor audits a named file whatever
 * its name. A directory is walked by zizmor's collection rules, and what git ignores is dropped, as
 * zizmor drops it.
 */
export async function findByteOrderMarks(
  inputs: readonly AuditInput[],
  workspace: string,
  ignored: IgnoreFilter = gitIgnoreFilter,
): Promise<string[]> {
  const toRelative = (path: string): string => relative(workspace, path).split(sep).join('/');
  const named = new Set<string>();
  const walked = new Set<string>();

  for (const input of inputs) {
    if (!input.directory) {
      named.add(input.absolute);
      continue;
    }

    for (const candidate of await collectCandidates(input.absolute, workspace)) {
      walked.add(candidate);
    }
  }

  const marked = async (paths: Iterable<string>): Promise<string[]> => {
    const result: string[] = [];

    for (const path of paths) {
      if (await startsWithByteOrderMark(path)) {
        result.push(toRelative(path));
      }
    }

    return result;
  };

  const fromWalk = await marked([...walked].filter((path) => !named.has(path)));
  const ignoredPaths = await ignored(workspace, fromWalk);
  const paths = new Set([...(await marked(named)), ...fromWalk.filter((path) => !ignoredPaths.has(path))]);

  return [...paths].sort();
}
