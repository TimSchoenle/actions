/**
 * Reader for the append-only files the runner exposes as `GITHUB_OUTPUT`, `GITHUB_ENV` and
 * `GITHUB_STATE`.
 *
 * All three share one format, so one parser serves them. `@actions/core` writes the heredoc form
 * (`key<<delimiter`), while shell steps commonly append the flat `key=value` form; both are accepted
 * because a composite action's steps and a node action's `setOutput` end up in the same file.
 */

/** Raised when a command file cannot be read as key/value pairs — always a bug, never bad input. */
export class FileCommandParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileCommandParseError';
  }
}

const HEREDOC_HEADER = /^([^<\r\n]+)<<(.+)$/;
const FLAT_PAIR = /^([^=\r\n]+)=(.*)$/;

/**
 * Parses the contents of a runner command file into its key/value pairs.
 *
 * A repeated key resolves to its last value, matching the runner: an action that writes an output
 * twice publishes the second write.
 */
export function parseFileCommands(contents: string): Record<string, string> {
  const lines = contents.split(/\r?\n/);
  const values: Record<string, string> = {};

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (line === '') {
      continue;
    }

    const heredoc = HEREDOC_HEADER.exec(line);

    if (heredoc) {
      const [, key, delimiter] = heredoc;
      const body: string[] = [];

      index++;

      while (index < lines.length && lines[index] !== delimiter) {
        body.push(lines[index]);
        index++;
      }

      if (index >= lines.length) {
        throw new FileCommandParseError(`Unterminated value for '${key}': delimiter '${delimiter}' never closed.`);
      }

      values[key] = body.join('\n');
      continue;
    }

    const flat = FLAT_PAIR.exec(line);

    if (!flat) {
      throw new FileCommandParseError(`Unparseable line ${index + 1}: ${JSON.stringify(line)}`);
    }

    values[flat[1]] = flat[2];
  }

  return values;
}
