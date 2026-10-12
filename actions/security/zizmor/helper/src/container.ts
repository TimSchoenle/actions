import { once } from 'node:events';
/**
 * Runs zizmor in its container and turns what happened into a verdict.
 *
 * The container is started with an argument vector, never through a shell, so no input is ever
 * re-split or expanded. It sees the workspace read-only, has no capabilities, runs as `nobody`, and
 * gets a network only when online audits need one. zizmor writes its cache to a tmpfs because the
 * root filesystem is read-only too.
 */
import { createWriteStream } from 'node:fs';

import { exec } from '@actions/exec';

import { ZizmorRunError } from './errors.js';

/** Where the workspace is mounted in the container, and zizmor's working directory. */
export const CONTAINER_WORKSPACE = '/workspace';

/** Size of the tmpfs zizmor's HTTP cache lives in. Online audits cache API responses there. */
const CACHE_TMPFS = '/tmp:rw,noexec,nosuid,nodev,size=256m';

/** User and group `nobody`. zizmor needs nothing a root user has. */
const UNPRIVILEGED_USER = '65534:65534';

/** Everything that decides how the container is started. */
export interface ContainerRun {
  readonly image: string;
  /** Absolute path of the workspace on the host. */
  readonly workspace: string;
  /** The arguments zizmor receives after the image name. */
  readonly zizmorArguments: readonly string[];
  /** Whether the container gets a network and the token. */
  readonly online: boolean;
}

/**
 * Renders one field of docker's `--mount` value.
 *
 * docker reads `--mount` as one CSV record, so a path containing a comma would end the field early
 * and a quote would open a quoted one. CSV quoting is the format's own escape.
 */
export function csvField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/**
 * The full `docker` argument vector.
 *
 * `--mount` rather than `--volume`, because `--volume` splits on `:` and a host path is free to
 * contain one. `GH_TOKEN` is passed by name, so its value is copied from this process's environment
 * and never appears in an argument list that `ps` or a debug log could show.
 */
export function dockerArguments(run: ContainerRun): string[] {
  const mount = ['type=bind', `source=${run.workspace}`, `target=${CONTAINER_WORKSPACE}`, 'readonly']
    .map(csvField)
    .join(',');

  return [
    'run',
    '--rm',
    '--read-only',
    `--tmpfs=${CACHE_TMPFS}`,
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--user=${UNPRIVILEGED_USER}`,
    `--mount=${mount}`,
    `--workdir=${CONTAINER_WORKSPACE}`,
    ...(run.online ? ['--env=GH_TOKEN'] : ['--network=none']),
    run.image,
    ...run.zizmorArguments,
  ];
}

/** Characters a terminal or log viewer treats specially, except the tab. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/gu;

/** Prefix of every relayed line. Not whitespace, so the runner never finds `::` at a line's start. */
export const RELAY_PREFIX = '| ';

/**
 * Renders one line of zizmor's log for the step log.
 *
 * zizmor's log carries file names and messages taken from the repository it audits, and the runner
 * reads every line of a step's output for `::` workflow commands. A file named
 * `x\n::add-mask::...` would otherwise reach the log as a command. The runner trims leading
 * whitespace before it looks, so the prefix is a visible character, and every control character is
 * escaped so none can move the cursor or hide text.
 */
export function relayLine(line: string): string {
  return `${RELAY_PREFIX}${line.replaceAll(CONTROL_CHARACTERS, (character) => `\\u${(character.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`)}`;
}

/**
 * Splits a stream into lines the way the runner does, on `\n`, `\r\n` and a lone `\r`.
 *
 * A `\r` at the end of a chunk is held back, because the `\n` that would make it a `\r\n` may be the
 * first byte of the next chunk.
 */
export class LineRelay {
  private pending = '';

  constructor(private readonly write: (line: string) => void) {}

  push(chunk: string): void {
    const text = this.pending + chunk;
    const holdCarriageReturn = text.endsWith('\r');
    const lines = (holdCarriageReturn ? text.slice(0, -1) : text).split(/\r\n|\r|\n/);

    this.pending = (lines.pop() ?? '') + (holdCarriageReturn ? '\r' : '');

    for (const line of lines) {
      this.write(relayLine(line));
    }
  }

  flush(): void {
    const rest = this.pending.endsWith('\r') ? this.pending.slice(0, -1) : this.pending;

    this.pending = '';

    if (rest !== '') {
      this.write(relayLine(rest));
    }
  }
}

/** What the container left behind. */
export interface ContainerResult {
  readonly exitCode: number;
}

/**
 * Starts the container, streaming zizmor's standard output into `sarifFile` and its log, line by
 * line and neutralised, into the step log.
 *
 * @param token - handed to the container as `GH_TOKEN` when the run is online.
 * @throws {@link ZizmorRunError} when `docker` cannot be started at all.
 */
export async function runContainer(
  run: ContainerRun,
  sarifFile: string,
  token: string | undefined,
  writeLog: (line: string) => void,
): Promise<ContainerResult> {
  const sarif = createWriteStream(sarifFile, { flags: 'wx', mode: 0o600 });
  const relay = new LineRelay(writeLog);
  const environment: Record<string, string> = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && name !== 'GH_TOKEN') {
      environment[name] = value;
    }
  }

  if (run.online && token !== undefined) {
    environment['GH_TOKEN'] = token;
  }

  let exitCode: number;

  try {
    exitCode = await exec('docker', dockerArguments(run), {
      env: environment,
      ignoreReturnCode: true,
      silent: true,
      listeners: {
        stdout: (chunk: Buffer) => {
          sarif.write(chunk);
        },
        stderr: (chunk: Buffer) => {
          relay.push(chunk.toString('utf8'));
        },
      },
    });
  } catch (error) {
    throw new ZizmorRunError(
      'docker could not be started. This action needs a Linux runner with Docker, such as ubuntu-latest.',
      { cause: error },
    );
  } finally {
    relay.flush();
    sarif.end();
    await once(sarif, 'close');
  }

  return { exitCode };
}

/**
 * Explains a non-zero exit, from zizmor's documented exit codes and docker's own.
 *
 * In SARIF mode zizmor never exits with its finding codes (10 to 14), so anything non-zero is a run
 * that did not complete.
 */
export function describeExit(exitCode: number): string {
  switch (exitCode) {
    case 1: {
      return (
        'zizmor exited with 1: it could not load an input, or an audit failed. Its log above names the file. ' +
        'With strict-collection on, a file it cannot parse fails the run instead of being skipped.'
      );
    }
    case 2: {
      return 'zizmor exited with 2: it rejected its arguments. This is a defect in this action.';
    }
    case 3: {
      return (
        'zizmor exited with 3: it collected no inputs. None of the paths in inputs holds a workflow, an ' +
        'action, a Dependabot configuration or a pre-commit file it audits.'
      );
    }
    case 125: {
      return (
        'docker exited with 125: the container did not start. The image pull needs egress to ghcr.io:443 and ' +
        'pkg-containers.githubusercontent.com:443, and the runner must run Linux containers.'
      );
    }
    case 126:
    case 127: {
      return `docker exited with ${exitCode}: zizmor could not be run inside the container.`;
    }
    default: {
      return `zizmor exited with ${exitCode}.`;
    }
  }
}
