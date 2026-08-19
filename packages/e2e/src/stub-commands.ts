/**
 * Stand-in executables on `PATH`, for an action that drives a tool the test machine does not have.
 *
 * Most actions here reach GitHub or the filesystem, and the harness gives them the real thing. Two
 * do not: an action that shells out to `cargo` or `docker` cannot be exercised on a laptop, and the
 * end-to-end job deliberately has no route to a package registry and no Docker daemon — so a case
 * that needed either would be a case that never ran.
 *
 * What is faked is exactly one thing: the behaviour of the external tool. Everything else stays
 * real — the shipped bundle, the `INPUT_*` decoding, the `action.yaml` defaults, the process spawn,
 * the argument vector, the exit code, the captured streams and the files that come back. That makes
 * the *argument vector* assertable, which is the half a shell implementation of the same action
 * could never test and the half that decides whether the right thing was run at all.
 *
 * A stub is driven by rules rather than by a callback because it runs in its own process: the whole
 * behaviour has to be serialisable into the script the action will spawn.
 */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** One canned response, selected by the arguments the stub was called with. */
export interface StubRule {
  /**
   * Arguments that must all be present for this rule to apply, compared by equality.
   *
   * Omitted, the rule matches anything, which is how a default is written. Rules are tried in order
   * and the first match wins.
   */
  when?: readonly string[];
  stdout?: string;
  stderr?: string;
  /** Defaults to 0. */
  exitCode?: number;
  /**
   * Content to write to the file named by the stub's last argument.
   *
   * For a tool whose contract is to produce a file rather than to print one — `docker cp` is the
   * case this exists for. Without it a stub could only ever be observed through its streams, and the
   * check that reads the copied contract would have nothing to read.
   */
  writeFinalArgument?: string;
}

/** One call a stub recorded, in the order the calls were made. */
export interface StubInvocation {
  command: string;
  args: string[];
  /** Working directory the action ran the tool in, which is itself worth asserting on. */
  cwd: string;
}

/** Raised when a stub is asked for something it was not given a rule for. */
export class StubCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StubCommandError';
  }
}

/** Name of the shared record every stub appends to, inside the stub directory. */
const LOG_FILE = 'invocations.jsonl';

const IS_WINDOWS = process.platform === 'win32';

/**
 * The body of a stub, with its configuration baked in.
 *
 * Written as a script rather than parameterised at run time so a stub carries no dependency on the
 * harness: the action spawns it with an environment the harness controls, and nothing about that
 * environment has to be remembered in two places.
 */
function stubScript(command: string, rules: readonly StubRule[], logFile: string): string {
  return `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

const COMMAND = ${JSON.stringify(command)};
const RULES = ${JSON.stringify(rules)};
const LOG = ${JSON.stringify(logFile)};

const args = process.argv.slice(2);

appendFileSync(LOG, JSON.stringify({ command: COMMAND, args, cwd: process.cwd() }) + '\\n', 'utf8');

const rule = RULES.find((candidate) => (candidate.when ?? []).every((argument) => args.includes(argument)));

if (rule === undefined) {
  process.stderr.write(\`stub \${COMMAND}: no rule matches \${JSON.stringify(args)}\\n\`);
  process.exit(127);
}

if (rule.writeFinalArgument !== undefined) {
  const destination = args[args.length - 1];

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, rule.writeFinalArgument, 'utf8');
}

if (rule.stdout !== undefined) {
  process.stdout.write(rule.stdout);
}

if (rule.stderr !== undefined) {
  process.stderr.write(rule.stderr);
}

process.exit(rule.exitCode ?? 0);
`;
}

/**
 * The shim the operating system will actually resolve from `PATH`.
 *
 * Windows resolves an extensionless file only through `PATHEXT`, so the stub is a `.cmd`; POSIX
 * resolves any executable file, so it is a `sh` script with the execute bit set. Both do nothing but
 * hand the arguments to node, whose own path is quoted because a default Windows install puts it
 * under `C:\\Program Files`.
 */
function shimContent(nodePath: string, scriptPath: string): string {
  return IS_WINDOWS
    ? ['@echo off', `"${nodePath}" "${scriptPath}" %*`, 'exit /b %ERRORLEVEL%', ''].join('\r\n')
    : ['#!/bin/sh', `exec "${nodePath}" "${scriptPath}" "$@"`, ''].join('\n');
}

/** A directory of stand-in executables, and the record of what was run through them. */
export class StubCommands {
  private constructor(
    /** Directory to prepend to `PATH`, so the stubs are found before anything real. */
    readonly path: string,
    private readonly logFile: string,
  ) {}

  /**
   * Writes one stub per named command.
   *
   * @param commands the rules for each command, keyed by the bare name the action invokes.
   */
  static async create(commands: Readonly<Record<string, readonly StubRule[]>>): Promise<StubCommands> {
    const directory = await mkdtemp(path.join(tmpdir(), 'actions-e2e-stub-'));
    const logFile = path.join(directory, LOG_FILE);

    await mkdir(directory, { recursive: true });
    await writeFile(logFile, '', 'utf8');

    for (const [command, rules] of Object.entries(commands)) {
      const script = path.join(directory, `${command}.stub.mjs`);
      const shim = path.join(directory, IS_WINDOWS ? `${command}.cmd` : command);

      await writeFile(script, stubScript(command, rules, logFile), 'utf8');
      await writeFile(shim, shimContent(process.execPath, script), 'utf8');

      if (!IS_WINDOWS) {
        await chmod(shim, 0o755);
      }
    }

    return new StubCommands(directory, logFile);
  }

  /**
   * `PATH` with the stubs in front of it.
   *
   * Prepended rather than replacing: the action still has to find node, and on Windows the shim runs
   * through `cmd.exe`, which the runner would not otherwise be able to locate.
   */
  pathPrepended(existing = process.env['PATH'] ?? ''): string {
    return `${this.path}${path.delimiter}${existing}`;
  }

  /** Every call any stub recorded, in order. */
  async invocations(): Promise<StubInvocation[]> {
    const log = await readFile(this.logFile, 'utf8');

    return log
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as StubInvocation);
  }

  /** Every call to one command, in order. */
  async invocationsOf(command: string): Promise<StubInvocation[]> {
    return (await this.invocations()).filter((invocation) => invocation.command === command);
  }

  /** The argument vectors one command was called with, which is what most cases assert on. */
  async argumentsOf(command: string): Promise<string[][]> {
    return (await this.invocationsOf(command)).map((invocation) => invocation.args);
  }

  async dispose(): Promise<void> {
    await rm(this.path, { recursive: true, force: true });
  }
}
