import fs from 'node:fs/promises';
import path from 'node:path';

import { ManifestNotFoundError, ManifestParseError, ManifestUnreadableError } from './errors.js';
import { readCargoManifest } from './readers/cargo.js';
import { readChartManifest } from './readers/chart.js';
import { readGradleManifest } from './readers/gradle.js';
import { readNpmManifest } from './readers/npm.js';

/** What every reader must produce. Absent facts are omitted, never guessed or defaulted. */
export interface ManifestFacts {
  /** Which reader produced this, so the payload can say what ecosystem the repository is. */
  kind: 'cargo' | 'chart' | 'gradle' | 'npm';
  /** The package name as the ecosystem spells it, which is not always the repository name. */
  name?: string;
  version: string;
  description?: string;
  license?: string;
  homepage?: string;
  /**
   * Version constraints the README's compatibility table states: `msrv`, `edition`, `jdk`,
   * `kubeVersion`, `appVersion`. Free-form because each ecosystem names different things, and a
   * fixed set would force every reader to emit blanks for the four it has no opinion about.
   */
  toolchain: Readonly<Record<string, string>>;
}

/** The largest manifest read. A manifest holds a few kilobytes of metadata. */
const MANIFEST_SIZE_LIMIT = 1024 * 1024;

/** A reader, keyed by the basename it claims. */
type ManifestReader = (source: string, manifestPath: string) => ManifestFacts;

/**
 * The manifests this action understands, in detection order.
 *
 * Order is the answer to a repository holding more than one — a Rust service with a `package.json`
 * for its Tailwind build, say. Cargo first because the estate is mostly Rust, and because a
 * `package.json` that exists only to pin a CSS toolchain describes nothing a README quotes.
 *
 * A repository where the order is wrong passes `manifest` explicitly. That is one line in a workflow
 * against a heuristic that would have to grow a special case per repository.
 */
const READERS: ReadonlyArray<readonly [string, ManifestReader]> = [
  ['Cargo.toml', readCargoManifest],
  ['package.json', readNpmManifest],
  ['Chart.yaml', readChartManifest],
  ['gradle.properties', readGradleManifest],
];

/** The filenames {@link detectManifest} looks for, in order, for error reporting. */
export const MANIFEST_CANDIDATES: readonly string[] = READERS.map(([name]) => name);

/**
 * Whether a path names a manifest this action can read.
 *
 * A trailing separator is refused before `basename` sees it, because `basename` strips one and would
 * report `Cargo.toml/` as a readable manifest. The read would then fail on a directory, with a
 * message about an unreadable file rather than about the trailing slash that caused it.
 */
export function readerFor(manifestPath: string): ManifestReader | undefined {
  const normalized = manifestPath.replaceAll('\\', '/');

  if (normalized.endsWith('/')) {
    return undefined;
  }

  const basename = path.posix.basename(normalized);

  return READERS.find(([name]) => name === basename)?.[1];
}

async function exists(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds the manifest to read when the caller named none.
 *
 * Looks only in the workspace root. Descending would find a workspace member's manifest as readily
 * as the root one, and which of five members describes the repository is not a question a directory
 * walk can answer.
 *
 * @throws {ManifestNotFoundError} when no candidate exists.
 */
export async function detectManifest(workspace: string): Promise<string> {
  for (const name of MANIFEST_CANDIDATES) {
    if (await exists(path.join(workspace, name))) {
      return name;
    }
  }

  throw new ManifestNotFoundError(MANIFEST_CANDIDATES);
}

/**
 * Reads a manifest's text, refusing one over {@link MANIFEST_SIZE_LIMIT} before reading it: a pull
 * request controls the manifest, and nothing else bounds what the read pulls into memory.
 */
async function readSource(absolutePath: string, reportedPath: string): Promise<string> {
  let size: number;

  try {
    ({ size } = await fs.stat(absolutePath));
  } catch (error) {
    throw new ManifestUnreadableError(reportedPath, error);
  }

  if (size > MANIFEST_SIZE_LIMIT) {
    throw new ManifestParseError(reportedPath, 'larger than 1 MiB, which no manifest this action reads needs to be.');
  }

  try {
    return await fs.readFile(absolutePath, 'utf8');
  } catch (error) {
    throw new ManifestUnreadableError(reportedPath, error);
  }
}

/**
 * Reads one manifest into the facts the payload needs.
 *
 * A path whose basename is not one of {@link MANIFEST_CANDIDATES} is refused here rather than parsed
 * on a guess: a reader picked by content sniffing would report a syntax error from the wrong parser.
 *
 * @throws {ManifestUnreadableError} if the file cannot be read, or names a form with no reader.
 * @throws {ManifestParseError} if the file is larger than 1 MiB, or not the shape its name promises.
 * @throws {ManifestFieldMissingError} if a required field is absent.
 */
export async function readManifest(absolutePath: string, reportedPath: string): Promise<ManifestFacts> {
  const reader = readerFor(reportedPath);

  if (reader === undefined) {
    throw new ManifestUnreadableError(
      reportedPath,
      new Error(`unsupported manifest; expected one of ${MANIFEST_CANDIDATES.join(', ')}`),
    );
  }

  return reader(await readSource(absolutePath, reportedPath), reportedPath);
}
