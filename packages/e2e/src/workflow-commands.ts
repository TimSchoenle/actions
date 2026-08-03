/**
 * Reader for the `::command::` lines an action writes to stdout.
 *
 * These are the annotations a human sees on the check run — `core.error`, `core.warning`,
 * `core.notice` — plus `add-mask`, which the harness needs so a failure report cannot print a
 * secret the action deliberately hid.
 */

/**
 * Matches only the `::name` prefix.
 *
 * The properties and the message are then split off by hand rather than by a second and third
 * group: a single pattern spanning all three needs optional, overlapping quantifiers, which is both
 * harder to read and a backtracking hazard the security lint rightly objects to.
 */
const COMMAND_PREFIX = /^::([\w-]+)/;

const SEPARATOR = '::';

/** The annotation channels a case can assert on. */
export interface WorkflowCommands {
  errors: string[];
  warnings: string[];
  notices: string[];
  debug: string[];
  /** Values the action asked the runner to redact, in the order they were registered. */
  masks: string[];
}

/** Reverses `escapeData` from `@actions/core`, which encodes only these three characters. */
function unescapeData(value: string): string {
  return value.replaceAll('%0D', '\r').replaceAll('%0A', '\n').replaceAll('%25', '%');
}

function emptyCommands(): WorkflowCommands {
  return { errors: [], warnings: [], notices: [], debug: [], masks: [] };
}

/**
 * Extracts every workflow command from a captured stdout stream.
 *
 * Lines that are not commands are ignored rather than collected: the raw stream is kept separately,
 * and duplicating it here would only invite assertions against unstructured log text.
 */
export function parseWorkflowCommands(stdout: string): WorkflowCommands {
  const commands = emptyCommands();

  for (const line of stdout.split(/\r?\n/)) {
    const prefix = COMMAND_PREFIX.exec(line);

    if (!prefix) {
      continue;
    }

    // Everything after the name is either ` key=value,…::message` or straight `::message`. Anything
    // else — `::foo=bar` in ordinary log output, say — only looks like a command.
    const rest = line.slice(prefix[0].length);
    const separator = rest.indexOf(SEPARATOR);

    if (separator === -1 || (separator > 0 && !rest.startsWith(' '))) {
      continue;
    }

    const message = unescapeData(rest.slice(separator + SEPARATOR.length));

    switch (prefix[1]) {
      case 'error': {
        commands.errors.push(message);
        break;
      }
      case 'warning': {
        commands.warnings.push(message);
        break;
      }
      case 'notice': {
        commands.notices.push(message);
        break;
      }
      case 'debug': {
        commands.debug.push(message);
        break;
      }
      case 'add-mask': {
        commands.masks.push(message);
        break;
      }
    }
  }

  return commands;
}

/**
 * Replaces every masked value in `text`, so a failure report can quote the action's own output.
 *
 * Longest first: masking `abc` before `abcdef` would leave `***def` on the page, which still leaks
 * the tail of the secret.
 */
export function redact(text: string, masks: readonly string[]): string {
  let redacted = text;

  for (const mask of [...masks].sort((a, b) => b.length - a.length)) {
    if (mask !== '') {
      redacted = redacted.replaceAll(mask, '***');
    }
  }

  return redacted;
}
