import { readFile } from 'node:fs/promises';

import { parseDocument } from 'yaml';

import type { Document, DocumentOptions, ParseOptions, SchemaOptions } from 'yaml';

/**
 * Narrow seam over the file system: resolves the file's contents, or `undefined` when the path is
 * not a readable file.
 *
 * Keeping the read behind a single injectable function lets the callers be exercised without
 * fixtures on disk, and — more importantly — avoids the TOCTOU gap an `exists()` + `read()` pair
 * would open, where the file can be replaced between the two calls.
 */
export type YamlFileReader = (filePath: string) => Promise<string | undefined>;

/**
 * The bash predecessors gated on `[ -f "$FILE" ]`, which is false both for a missing path and for a
 * directory. `readFile` reports those as ENOENT and EISDIR respectively; every other error (EACCES,
 * EMFILE, ...) is a genuine fault and must surface rather than be reported as "not found".
 */
const NOT_A_READABLE_FILE = new Set(['ENOENT', 'EISDIR']);

function isNotAReadableFile(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && typeof error.code === 'string' && NOT_A_READABLE_FILE.has(error.code)
  );
}

export const readYamlFile: YamlFileReader = async (filePath) => {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNotAReadableFile(error)) {
      return undefined;
    }
    throw error;
  }
};

/** Raised when the YAML file does not exist, or is not a file at all. */
export class YamlFileNotFoundError extends Error {
  constructor(readonly filePath: string) {
    super(`File not found: ${filePath}`);
    this.name = 'YamlFileNotFoundError';
  }
}

/** Raised when the file exists but does not parse as YAML. */
export class YamlParseError extends Error {
  constructor(readonly reason: string) {
    super(`YAML parse error: ${reason}`);
    this.name = 'YamlParseError';
  }
}

/** Raised when a dot-path addresses nothing in the document. */
export class YamlKeyNotFoundError extends Error {
  constructor(
    readonly keyPath: string,
    readonly filePath: string,
  ) {
    super(`Key '${keyPath}' not found in ${filePath}`);
    this.name = 'YamlKeyNotFoundError';
  }
}

/** A parsed document, alongside the exact source it was parsed from. */
export interface LoadedYaml {
  document: Document;
  /** The file verbatim. A caller editing in place splices into this, preserving every other byte. */
  source: string;
}

/**
 * Reads and parses the YAML file at `filePath`.
 *
 * @throws {YamlFileNotFoundError} if the path is not a readable file.
 * @throws {YamlParseError} if the contents do not parse.
 */
export async function loadYaml(
  filePath: string,
  options: ParseOptions & DocumentOptions & SchemaOptions = {},
  read: YamlFileReader = readYamlFile,
): Promise<LoadedYaml> {
  const source = await read(filePath);

  if (source === undefined) {
    throw new YamlFileNotFoundError(filePath);
  }

  const document = parseDocument(source, options);

  if (document.errors.length > 0) {
    throw new YamlParseError(document.errors[0].message);
  }

  return { document, source };
}

/**
 * Splits a dot-path into the keys it addresses.
 *
 * `app.database.host` walks three levels, and a numeric segment indexes a sequence. A key that itself
 * contains a dot is consequently not addressable; that limitation is inherited from the `yq`
 * invocations these actions replace, and `read-yaml` and `modify-yaml` must agree on it — whatever
 * one can write at `a.b.c`, the other has to read back from `a.b.c`.
 */
export function splitKeyPath(keyPath: string): string[] {
  return keyPath.split('.');
}
