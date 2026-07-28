import { readFile } from 'node:fs/promises';

import { TemplateNotFoundError } from './errors.js';

/** UTF-8 byte order mark, which a Windows editor may prepend to a template file. */
const BYTE_ORDER_MARK = '﻿';

/**
 * Normalizes a template's source so the rendered bytes do not depend on how it was checked out.
 *
 * Git's `core.autocrlf` rewrites line endings per machine, and an editor may prepend a BOM. Neither
 * is content, but both would reach the output file verbatim — and then the drift check would report
 * a file as stale purely because it was regenerated on a different workstation. Everything this
 * action writes is therefore LF-terminated and BOM-free, whatever the template looks like on disk.
 */
export function normalizeSource(source: string): string {
  const withoutMark = source.startsWith(BYTE_ORDER_MARK) ? source.slice(BYTE_ORDER_MARK.length) : source;

  return withoutMark.replaceAll(/\r\n|\r/g, '\n');
}

/**
 * Reads a template or partial as normalized UTF-8 text.
 *
 * @throws {TemplateNotFoundError} if the path is not a readable file — including a directory, which
 * a bare `readFile` reports as an unhelpful `EISDIR`.
 */
export async function readTemplateSource(path: string): Promise<string> {
  try {
    return normalizeSource(await readFile(path, 'utf8'));
  } catch (error) {
    throw new TemplateNotFoundError(path, error);
  }
}
