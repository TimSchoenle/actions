import { ManifestFieldMissingError } from '../errors.js';

import type { ManifestFacts } from '../manifest.js';

/**
 * Reads a Gradle project's version and toolchain out of `gradle.properties`.
 *
 * `gradle.properties` and not `build.gradle`: the build script is a program, and the version in it
 * can be computed, read from git, or set by a plugin. A properties file is data, so what it says is
 * what the build uses. A project that computes its version writes it here for this action to read,
 * which is one line against a Groovy parser that would still be guessing.
 *
 * The format is `java.util.Properties`: `key=value`, `key:value` or `key value`, comments with `#`
 * or `!`, and a trailing backslash continuing onto the next line. Scanned rather than matched, for
 * the reason the Cargo reader gives: the pattern this replaces nested a quantifier in a quantifier.
 */

/** The properties whose values become `toolchain` entries, under the names a README states. */
const TOOLCHAIN_PROPERTIES: ReadonlyArray<readonly [string, string]> = [
  ['javaVersion', 'jdk'],
  ['java.version', 'jdk'],
  ['jdkVersion', 'jdk'],
  ['gradleVersion', 'gradle'],
];

/** The horizontal whitespace the format treats as a separator. A newline never reaches here. */
function isBlank(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\f';
}

/**
 * Whether a line ends in a continuation.
 *
 * An odd number of trailing backslashes continues onto the next line; an even number is an escaped
 * backslash that happens to sit at the end of a value.
 */
function continues(line: string): boolean {
  let backslashes = 0;

  for (let index = line.length - 1; index >= 0 && line[index] === '\\'; index--) {
    backslashes++;
  }

  return backslashes % 2 === 1;
}

/**
 * Joins backslash-continued lines before any of them is parsed.
 *
 * Whitespace before the backslash is part of the value and is kept; whitespace at the start of the
 * line being continued onto is indentation and is dropped.
 */
function logicalLines(source: string): string[] {
  const joined: string[] = [];
  let pending = '';

  for (const raw of source.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const current = pending + (pending === '' ? line : line.trimStart());

    if (continues(current)) {
      pending = current.slice(0, -1);
      continue;
    }

    pending = '';
    joined.push(current);
  }

  if (pending !== '') {
    joined.push(pending);
  }

  return joined;
}

/**
 * Splits one logical line into its key and value.
 *
 * The key runs until the first unescaped separator, which is `=`, `:` or whitespace. At most one
 * `=` or `:` is then consumed, so `key = value` and `key value` both yield the same pair.
 */
export function splitProperty(line: string): { key: string; value: string } | undefined {
  let key = '';
  let index = 0;

  for (; index < line.length; index++) {
    const character = line[index];

    if (character === '\\') {
      const escaped = line[index + 1];

      if (escaped === undefined) {
        return undefined;
      }

      key += escaped;
      index++;
      continue;
    }

    if (character === '=' || character === ':' || isBlank(character)) {
      break;
    }

    key += character;
  }

  if (key === '') {
    return undefined;
  }

  while (isBlank(line[index])) {
    index++;
  }

  if (line[index] === '=' || line[index] === ':') {
    index++;
  }

  while (isBlank(line[index])) {
    index++;
  }

  return { key, value: line.slice(index).trimEnd() };
}

/** Parses the file into its properties. First writer wins, as `Properties` itself does not. */
export function parseProperties(source: string): Map<string, string> {
  const properties = new Map<string, string>();

  for (const raw of logicalLines(source)) {
    const line = raw.trimStart();

    if (line === '' || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }

    const property = splitProperty(line);

    if (property !== undefined && !properties.has(property.key)) {
      properties.set(property.key, property.value);
    }
  }

  return properties;
}

/**
 * Reads the facts a README quotes out of a `gradle.properties`.
 *
 * @throws {ManifestFieldMissingError} if `version` is absent.
 */
export function readGradleManifest(source: string, manifestPath: string): ManifestFacts {
  const properties = parseProperties(source);
  const version = properties.get('version');

  if (version === undefined || version === '') {
    throw new ManifestFieldMissingError(
      manifestPath,
      'version',
      'A version computed in build.gradle cannot be read here; write it to gradle.properties.',
    );
  }

  const toolchain: Record<string, string> = {};

  for (const [property, name] of TOOLCHAIN_PROPERTIES) {
    const value = properties.get(property);

    // First match wins across the aliases, so a project declaring both spellings gets the first.
    if (value !== undefined && value !== '' && !(name in toolchain)) {
      toolchain[name] = value;
    }
  }

  const group = properties.get('group');
  const artifact = properties.get('artifactId') ?? properties.get('name');

  return {
    kind: 'gradle',
    name: group !== undefined && artifact !== undefined ? `${group}:${artifact}` : artifact,
    version,
    description: properties.get('description'),
    toolchain,
  };
}
