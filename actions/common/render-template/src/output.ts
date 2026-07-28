import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { OutputDriftError } from './errors.js';

/** How much of a differing line is quoted in a drift report before it is elided. */
const MAX_QUOTED_LENGTH = 120;

/** What became of the output file. */
export interface RenderOutcome {
  /** Whether the rendered content differs from what was already at the path. */
  changed: boolean;
  /** SHA-256 of the rendered content, as lowercase hex. */
  checksum: string;
}

function checksumOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Reads the current output, or `undefined` when there is none. */
async function readExisting(outputPath: string): Promise<string | undefined> {
  try {
    return await readFile(outputPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

function quote(line: string | undefined): string {
  if (line === undefined) {
    return '<end of file>';
  }

  return line.length > MAX_QUOTED_LENGTH ? `${line.slice(0, MAX_QUOTED_LENGTH)}…` : line;
}

/**
 * Explains where the committed file and the rendered content part ways.
 *
 * A drift check that only says "out of date" sends the caller off to reproduce the render locally
 * before they know whether they are looking at a real change or at a stray newline. The first
 * differing line is almost always enough to tell those apart from the job log alone.
 */
export function describeDrift(existing: string | undefined, rendered: string): string {
  if (existing === undefined) {
    return 'The file does not exist; rendering it would create it.';
  }

  const existingLines = existing.split('\n');
  const renderedLines = rendered.split('\n');
  const index = existingLines.findIndex((line, at) => line !== renderedLines[at]);

  // Equal line by line up to the shorter of the two, so the difference is a suffix one of them has.
  if (index === -1) {
    return `The file has ${existingLines.length} line(s), the rendered content has ${renderedLines.length}.`;
  }

  return `First difference on line ${index + 1}:\n  on disk:  ${quote(existingLines[index])}\n  rendered: ${quote(renderedLines[index])}`;
}

/**
 * Writes the rendered content, or verifies that it is already there.
 *
 * An unchanged file is left completely untouched rather than rewritten with identical bytes: the
 * common case for a generated README is that nothing changed, and rewriting it would move its
 * modification time and defeat any build step keyed on that.
 *
 * Under `check` nothing is written at all. That is what makes this action usable as the gate that a
 * generated file was regenerated — the same code path that produces the file decides whether the
 * committed one matches it, so the check cannot disagree with the generator.
 *
 * @throws {OutputDriftError} if `check` is set and the file is missing or stale.
 */
export async function applyOutput(
  outputPath: string,
  content: string,
  options: { check: boolean },
): Promise<RenderOutcome> {
  const existing = await readExisting(outputPath);
  const changed = existing !== content;
  const checksum = checksumOf(content);

  if (options.check) {
    if (changed) {
      throw new OutputDriftError(outputPath, describeDrift(existing, content));
    }

    return { changed, checksum };
  }

  if (changed) {
    await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, content, 'utf8');
  }

  return { changed, checksum };
}
