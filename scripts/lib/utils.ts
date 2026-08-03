import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Sys } from './sys';

export { Sys };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
export { ROOT_DIR };
export const ACTIONS_DIR = path.join(ROOT_DIR, 'actions');
export const START_VERSION = '1.0.0';

/**
 * Whether one path segment matches one glob segment.
 *
 * Written out rather than compiled to a `RegExp`: building a pattern from a caller-supplied string
 * is the shape of an injection, and the security lint is right to object to it even though every
 * caller here passes a literal.
 */
function segmentMatches(segment: string, name: string): boolean {
  const parts = segment.split('*');

  if (parts.length === 1) {
    return segment === name;
  }

  const prefix = parts[0];
  const suffix = parts[parts.length - 1];

  if (!name.startsWith(prefix) || !name.endsWith(suffix) || prefix.length + suffix.length > name.length) {
    return false;
  }

  let cursor = prefix.length;

  for (const middle of parts.slice(1, -1)) {
    const found = name.indexOf(middle, cursor);

    if (found === -1 || found + middle.length > name.length - suffix.length) {
      return false;
    }

    cursor = found + middle.length;
  }

  return true;
}

/** Expands one glob segment across the paths matched so far. */
function expandSegment(parents: readonly string[], segment: string, isLast: boolean): string[] {
  const matched: string[] = [];

  for (const parent of parents) {
    const directory = path.join(ROOT_DIR, parent);

    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      continue;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      // A trailing segment names a file and every earlier one names a directory, so the entry kind
      // is a filter rather than an afterthought: without it `actions/*/*` would also yield files.
      if (entry.isDirectory() !== isLast && segmentMatches(segment, entry.name)) {
        matched.push(parent === '' ? entry.name : `${parent}/${entry.name}`);
      }
    }
  }

  return matched;
}

/**
 * Expands a shallow glob to a sorted list of repository-relative paths.
 *
 * Two properties matter. First, order: a raw directory read yields in filesystem order, which differs
 * between Windows and Linux, so anything that turns these paths into a committed file — a generated
 * workflow, a README table — would churn back and forth forever without the sort. Second, runtime
 * independence: this runs under bun in the scripts and under node in vitest, so it cannot use
 * `Bun.Glob`.
 *
 * Only `*` within a single segment is supported, which is all the callers need; `**` deliberately is
 * not, so nobody reaches for a recursive scan of the whole tree by accident.
 */
export async function scanSorted(pattern: string): Promise<string[]> {
  const segments = pattern.split('/');
  let matches = [''];

  for (const [depth, segment] of segments.entries()) {
    matches = expandSegment(matches, segment, depth === segments.length - 1);
  }

  return matches.sort();
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseRepoName(origin: string): string {
  const trimmed = origin.trim();
  if (!trimmed) {
    throw new Error(`Could not parse repo name from origin: ${origin}`);
  }
  // Handle git@github.com:User/repo.git or https://github.com/User/repo.git
  const match = new RegExp(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/).exec(trimmed);
  if (!match) {
    throw new Error(`Could not parse repo name from origin: ${origin}`);
  }
  return match[1];
}

export async function getRepoName(): Promise<string> {
  const origin = await Sys.exec('git remote get-url origin');
  return parseRepoName(origin);
}

export function replaceTemplateVariables(content: string, replacements: Record<string, string>): string {
  let newContent = content;
  for (const [key, value] of Object.entries(replacements)) {
    // Escape special regex characters in the key
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- Key is escaped above to prevent ReDoS
    newContent = newContent.replaceAll(new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g'), () => value);
  }
  return newContent;
}

export async function createFromTemplate(templateName: string, destPath: string, replacements: Record<string, string>) {
  const templatePath = path.join(__dirname, '..', 'templates', templateName);
  const templateFile = Sys.file(templatePath);
  const content = await templateFile.text();

  const finalContent = replaceTemplateVariables(content, replacements);

  await Sys.write(destPath, finalContent);
}
