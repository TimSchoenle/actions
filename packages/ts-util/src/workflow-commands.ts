/**
 * The two wire formats an action speaks to the runner in: workflow commands on stdout
 * (`::name key=value::message`) and file commands appended to the files the runner names in
 * `GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_STATE` and `GITHUB_PATH`.
 *
 * Byte-for-byte the format `@actions/core` writes, which is what the runner parses. Kept free of any
 * I/O so the escaping — the part an attacker-controlled value has to get past — is testable on its
 * own, including by the fuzz suite.
 */
import { randomUUID } from 'node:crypto';
import { EOL } from 'node:os';

/** Where an annotation points, as `core.error`, `core.warning` and `core.notice` accept it. */
export interface AnnotationProperties {
  /** A title for the annotation. */
  title?: string;
  /** The path of the file the annotation is for. */
  file?: string;
  /** The first line of the range. */
  startLine?: number;
  /** The last line of the range; defaults to `startLine`. */
  endLine?: number;
  /** The first column of the range. Ignored by the runner when the range spans lines. */
  startColumn?: number;
  /** The last column of the range. Ignored by the runner when the range spans lines. */
  endColumn?: number;
}

/** The properties of one workflow command, in the order they are written. */
export type CommandProperties = Readonly<Record<string, unknown>>;

/**
 * Renders any value the way the runner expects to receive it: strings verbatim, `null` and
 * `undefined` as the empty string, and everything else as JSON.
 */
export function toCommandValue(input: unknown): string {
  if (input === null || input === undefined) {
    return '';
  }

  if (typeof input === 'string' || input instanceof String) {
    return input.toString();
  }

  return JSON.stringify(input);
}

/**
 * Escapes a command's message. `%` goes first so the escapes this introduces are not escaped again;
 * a raw line break would otherwise end the command and start a line the runner parses afresh.
 */
export function escapeData(value: unknown): string {
  return toCommandValue(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

/**
 * Escapes a property value. On top of {@link escapeData}, `:` and `,` are escaped because they end
 * the property list and separate its entries: an unescaped one would let a value inject a property.
 */
export function escapeProperty(value: unknown): string {
  return escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

/**
 * Renders one workflow command line, without its line terminator.
 *
 * Properties whose value is falsy are left out, as `@actions/core` does: an annotation without a
 * line number must not say `line=` (or `line=0`). Like `@actions/core`, the space before the
 * property list is written whenever properties were passed at all, even if every one was left out;
 * the runner reads `::error ::message` and `::error::message` alike.
 */
export function formatCommand(command: string, properties: CommandProperties, message: unknown): string {
  const keys = Object.keys(properties);
  const rendered = keys
    .filter((key) => Boolean(properties[key]))
    .map((key) => `${key}=${escapeProperty(properties[key])}`)
    .join(',');

  return `::${command === '' ? 'missing.command' : command}${keys.length > 0 ? ` ${rendered}` : ''}::${escapeData(message)}`;
}

/** Maps the annotation properties to the property names the runner reads. */
export function toCommandProperties(properties: AnnotationProperties): CommandProperties {
  if (Object.keys(properties).length === 0) {
    return {};
  }

  return {
    title: properties.title,
    file: properties.file,
    line: properties.startLine,
    endLine: properties.endLine,
    col: properties.startColumn,
    endColumn: properties.endColumn,
  };
}

/**
 * Renders `key` and `value` as one heredoc entry of a file command, without its line terminator.
 *
 * The delimiter is random per entry, so a value cannot know it in advance; a key or value that
 * nonetheless contains it is refused rather than written, because the runner would end the value
 * early at it and read whatever follows as further entries.
 *
 * @param delimiterId the random part of the delimiter, injectable so tests can force a collision.
 */
export function prepareKeyValueMessage(key: string, value: unknown, delimiterId: string = randomUUID()): string {
  const delimiter = `ghadelimiter_${delimiterId}`;
  const convertedValue = toCommandValue(value);

  if (key.includes(delimiter)) {
    throw new Error(`Unexpected input: name should not contain the delimiter "${delimiter}"`);
  }

  if (convertedValue.includes(delimiter)) {
    throw new Error(`Unexpected input: value should not contain the delimiter "${delimiter}"`);
  }

  return `${key}<<${delimiter}${EOL}${convertedValue}${EOL}${delimiter}`;
}
