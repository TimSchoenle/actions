import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Files to seed a workspace with, keyed by path relative to its root. */
export type WorkspaceFiles = Readonly<Record<string, string>>;

/** Raised when a workspace cannot be prepared, or a case tries to escape it. */
export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export interface GitOptions {
  /**
   * Token for an authenticated remote operation.
   *
   * Delivered through a throwaway config file rather than the URL or `-c`: a token in the remote URL
   * is written into `.git/config` and survives the run, and a token in `-c` is visible in the process
   * list to anything else on the machine. The file is written with owner-only permissions and
   * removed as soon as the command returns.
   */
  authToken?: string;
}

/**
 * Rejects a fixture path that would write outside the workspace.
 *
 * Cases are trusted code, so this is not a security boundary — it is a guard against a `..` slipping
 * into a fixture and quietly overwriting something in the repository the tests were launched from.
 */
function resolveWithin(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new WorkspaceError(`Fixture path '${relativePath}' resolves outside the workspace.`);
  }

  return resolved;
}

function authConfig(token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');

  return `[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic ${basic}\n`;
}

/**
 * A scratch directory handed to an action as `GITHUB_WORKSPACE`.
 *
 * Actions that only talk to the API need none of this, and {@link runAction} gives them an empty one
 * by default. It exists for the rest: `read-yaml` and `modify-yaml` read a file, `render-template`
 * writes one, and `commit-changes` shells out to `git status` and so needs a real working tree.
 */
export class Workspace {
  private constructor(
    readonly path: string,
    private readonly configDirectory: string,
  ) {}

  /** Creates an empty workspace, optionally seeded with fixture files. */
  static async create(files: WorkspaceFiles = {}): Promise<Workspace> {
    const root = await mkdtemp(path.join(tmpdir(), 'actions-e2e-ws-'));
    // Kept outside the workspace so it is invisible to the action and to `git status`.
    const configDirectory = await mkdtemp(path.join(tmpdir(), 'actions-e2e-git-'));
    const workspace = new Workspace(root, configDirectory);

    // An empty global config, so a developer's own git settings — autocrlf, gpgsign, a default
    // branch name — cannot change what a case observes.
    await writeFile(path.join(configDirectory, 'gitconfig'), '', 'utf8');
    await workspace.write(files);

    return workspace;
  }

  /** Writes fixture files, creating parent directories as needed. */
  async write(files: WorkspaceFiles): Promise<void> {
    for (const [relativePath, contents] of Object.entries(files)) {
      const target = resolveWithin(this.path, relativePath);

      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents, 'utf8');
    }
  }

  /** Writes fixture bytes, for content that is not valid UTF-8 or must contain an exact byte. */
  async writeBytes(relativePath: string, contents: Uint8Array): Promise<void> {
    const target = resolveWithin(this.path, relativePath);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }

  /**
   * Links `relativePath` at `target`, which may deliberately point outside the workspace.
   *
   * The escape hatch for the one file-system trick a fixture cannot express as content: an action
   * that resolves a path without checking what it lands on will happily read or rewrite whatever the
   * link points at. Callers must gate on {@link symlinksSupported} — an unprivileged Windows session
   * without developer mode cannot create one, and a case that silently skipped would be worse than
   * one that never ran.
   */
  async symlink(relativePath: string, target: string): Promise<void> {
    const link = resolveWithin(this.path, relativePath);

    await mkdir(path.dirname(link), { recursive: true });
    await symlink(target, link);
  }

  /**
   * Whether this platform lets the test process create symbolic links.
   *
   * Probed rather than assumed from `process.platform`: Windows allows them under developer mode or
   * an elevated session, so the answer differs between two machines running the same OS.
   */
  static async symlinksSupported(): Promise<boolean> {
    const probe = await mkdtemp(path.join(tmpdir(), 'actions-e2e-link-'));

    try {
      await symlink(path.join(probe, 'target'), path.join(probe, 'link'));
      return true;
    } catch {
      return false;
    } finally {
      await rm(probe, { recursive: true, force: true });
    }
  }

  /** Reads a file back, for asserting on what an action wrote. */
  async read(relativePath: string): Promise<string> {
    return readFile(resolveWithin(this.path, relativePath), 'utf8');
  }

  /**
   * Every file in the workspace, as sorted workspace-relative POSIX paths.
   *
   * The assertion an action's happy path cannot make: that a hostile output path wrote *nothing*,
   * rather than writing somewhere the case forgot to look. Directories are not listed; only the files
   * that would end up in a commit.
   */
  async entries(): Promise<string[]> {
    const found: string[] = [];

    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          await walk(absolute);
        } else {
          found.push(path.relative(this.path, absolute).split(path.sep).join('/'));
        }
      }
    };

    await walk(this.path);

    return found.sort();
  }

  /** Whether a path exists, for asserting that an action created or left alone a file. */
  async exists(relativePath: string): Promise<boolean> {
    try {
      await stat(resolveWithin(this.path, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  /** Runs git in the workspace against a hermetic configuration, and returns its stdout. */
  async git(args: readonly string[], options: GitOptions = {}): Promise<string> {
    const configFile =
      options.authToken === undefined
        ? path.join(this.configDirectory, 'gitconfig')
        : path.join(this.configDirectory, `auth-${Date.now()}`);

    try {
      if (options.authToken !== undefined) {
        await writeFile(configFile, authConfig(options.authToken), { encoding: 'utf8', mode: 0o600 });
      }

      const { stdout } = await run('git', [...args], {
        cwd: this.path,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: configFile,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_TERMINAL_PROMPT: '0',
        },
      });

      return stdout;
    } finally {
      if (options.authToken !== undefined) {
        await rm(configFile, { force: true });
      }
    }
  }

  /** Turns the workspace into an empty git repository, which is all `git config` needs. */
  async initGit(defaultBranch = 'main'): Promise<void> {
    await this.git(['init', '--quiet', `--initial-branch=${defaultBranch}`]);
  }

  /** Reads a repository-local git config value, or `undefined` when it is unset. */
  async gitConfig(key: string): Promise<string | undefined> {
    try {
      return (await this.git(['config', '--local', '--get', key])).trim();
    } catch {
      // `git config --get` exits 1 for a key that is simply not set.
      return undefined;
    }
  }

  async dispose(): Promise<void> {
    await rm(this.path, { recursive: true, force: true });
    await rm(this.configDirectory, { recursive: true, force: true });
  }
}
