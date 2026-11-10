import fs from 'node:fs';
import path from 'node:path';

import { toRepoPath } from 'action-graph';

import type { ReleaseSpec } from './publish.js';

/** GitHub's limit on a release body, in characters. */
const MAX_NOTES_LENGTH = 125_000;

/** The keys a release entry may carry: the plan-release-please output, or a hand-written subset. */
const KNOWN_KEYS = new Set(['consumerTag', 'sourceTag', 'releaseName', 'notesFile', 'path', 'component', 'version']);

const MAX_NAME_LENGTH = 200;

/**
 * Whether `name` is a ref name this action creates: `/`-separated segments of letters, digits, `.`,
 * `_`, `+` and `-`, each starting with a letter or digit, with no `..` and no `.lock` suffix. A
 * subset of what git accepts, so the name needs no escaping anywhere it is used.
 */
export function isSafeRefName(name: string): boolean {
  return (
    name.length <= 250 &&
    name
      .split('/')
      .every(
        (segment) =>
          /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(segment) && !segment.endsWith('.lock') && !segment.endsWith('.'),
      ) &&
    !name.includes('..')
  );
}

function fail(index: number, message: string): never {
  throw new Error(`releases[${index}]: ${message}`);
}

function readNotes(file: unknown, index: number): string {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    fail(index, "'notesFile' must be an absolute path.");
  }
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(file);
  } catch {
    fail(index, `notes file ${file} does not exist.`);
  }
  if (!stats.isFile()) {
    fail(index, `notes file ${file} is not a regular file.`);
  }
  const notes = fs.readFileSync(file, 'utf8');
  if (notes.length > MAX_NOTES_LENGTH) {
    fail(index, `notes file ${file} is longer than the ${MAX_NOTES_LENGTH} characters a release body may hold.`);
  }

  return notes;
}

function optionalString(record: Record<string, unknown>, key: string, index: number): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value === '') {
    fail(index, `'${key}' must be a non-empty string or null.`);
  }

  return value;
}

function parseEntry(entry: unknown, index: number): ReleaseSpec {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    fail(index, 'must be an object.');
  }
  const record = entry as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) {
    fail(index, `unknown keys: ${unknown.join(', ')}.`);
  }

  const consumerTag = record['consumerTag'];
  if (typeof consumerTag !== 'string' || !isSafeRefName(consumerTag)) {
    fail(index, `'consumerTag' ${JSON.stringify(consumerTag)} is not a valid tag name.`);
  }
  const sourceTag = optionalString(record, 'sourceTag', index);
  if (sourceTag !== undefined && (!isSafeRefName(sourceTag) || sourceTag === consumerTag)) {
    fail(index, `'sourceTag' ${JSON.stringify(sourceTag)} must be a valid tag name other than the consumer tag.`);
  }
  const releaseName = record['releaseName'];
  if (
    typeof releaseName !== 'string' ||
    releaseName.trim() === '' ||
    releaseName.length > MAX_NAME_LENGTH ||
    /[\r\n]/.test(releaseName)
  ) {
    fail(index, `'releaseName' must be one line of 1 to ${MAX_NAME_LENGTH} characters.`);
  }
  const packagePath = optionalString(record, 'path', index);

  return {
    consumerTag,
    sourceTag,
    releaseName,
    notes: readNotes(record['notesFile'], index),
    path: packagePath === undefined ? undefined : toRepoPath(packagePath, `releases[${index}].path`),
  };
}

/**
 * Parses and validates the `releases` input. Every consumer tag and every source tag is unique.
 *
 * @throws an `Error` naming the entry and the problem
 */
export function parseReleases(text: string): ReleaseSpec[] {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(`releases is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  if (!Array.isArray(document) || document.length === 0) {
    throw new Error('releases must be a non-empty JSON array.');
  }

  const releases = document.map((entry: unknown, index) => parseEntry(entry, index));
  const tags = releases.flatMap((release) => [
    release.consumerTag,
    ...(release.sourceTag === undefined ? [] : [release.sourceTag]),
  ]);
  const duplicate = tags.find((tag, index) => tags.indexOf(tag) !== index);
  if (duplicate !== undefined) {
    throw new Error(`releases names the tag ${duplicate} twice.`);
  }

  return releases;
}
