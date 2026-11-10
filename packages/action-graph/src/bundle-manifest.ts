/**
 * The bundle manifest: the file that travels with built bundles from the job that built them to every
 * job that installs or publishes them, and that pins each file to its size and SHA-256.
 *
 * An artifact holds the bundles at their repository paths, `bundles.json` and `bundles.sha256` at its
 * root. The SHA-256 of `bundles.json` is the one value a consumer must get from somewhere it trusts
 * (the build job's outputs); {@link verifyBundleDirectory} then checks everything else against it.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import path from 'node:path';

import { isSha256Hex, sha256Hex } from './hash.js';
import {
  hasControlCharacter,
  isWithin,
  joinRepoPath,
  parentOf,
  ROOT,
  sortedUnique,
  toAbsolute,
  toRepoPath,
} from './paths.js';

/** File name of the manifest at the artifact root. */
export const MANIFEST_FILE = 'bundles.json';

/** File name of the checksum list at the artifact root, in `sha256sum` format. */
export const CHECKSUMS_FILE = 'bundles.sha256';

/** The manifest format this package reads and writes. */
export const MANIFEST_SCHEMA = 1;

/** Longest free-text field accepted, so a manifest cannot carry an unbounded string into a log. */
const MAX_TEXT_LENGTH = 200;

/** One bundle file. */
export interface BundleFile {
  /** Repository-relative path. */
  readonly path: string;
  /** Lowercase hexadecimal SHA-256 of the content. */
  readonly sha256: string;
  /** Size in bytes. */
  readonly size: number;
}

/** The content of `bundles.json`. */
export interface BundleManifest {
  readonly schema: typeof MANIFEST_SCHEMA;
  /** The commit the bundles were built from. */
  readonly sourceSha: string;
  /** Free text naming the toolchain, for example `bun 1.4.4`. Empty when the caller gave none. */
  readonly toolchain: string;
  /** What wrote the manifest. */
  readonly generatedBy: string;
  /** The directories the build ran in. Every file lies below one of them. */
  readonly buildDirs: readonly string[];
  /** Every bundle, sorted by path. */
  readonly files: readonly BundleFile[];
}

/** Raised when a manifest or an artifact directory fails a check. The message names what failed. */
export class BundleVerificationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BundleVerificationError';
  }
}

/** A full commit id: 40 hexadecimal digits for SHA-1 repositories, 64 for SHA-256 ones. */
function isCommitId(value: string): boolean {
  return (value.length === 40 || value.length === 64) && /^[0-9a-f]+$/.test(value);
}

function fail(message: string, cause?: unknown): never {
  throw new BundleVerificationError(message, cause === undefined ? undefined : { cause });
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Renders a manifest exactly as it is written to disk: stable key order, two-space indent, final newline. */
export function serializeManifest(manifest: BundleManifest): string {
  const ordered: BundleManifest = {
    schema: manifest.schema,
    sourceSha: manifest.sourceSha,
    toolchain: manifest.toolchain,
    generatedBy: manifest.generatedBy,
    buildDirs: [...manifest.buildDirs],
    files: manifest.files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size })),
  };

  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Renders `bundles.sha256`: one `<sha256>  <path>` line per file, in manifest order. */
export function renderChecksums(files: readonly BundleFile[]): string {
  return files.map((file) => `${file.sha256}  ${file.path}\n`).join('');
}

function checkText(value: unknown, field: string, { allowEmpty }: { allowEmpty: boolean }): string {
  if (typeof value !== 'string' || (!allowEmpty && value === '')) {
    fail(`${MANIFEST_FILE}: '${field}' must be a${allowEmpty ? '' : ' non-empty'} string.`);
  }
  if (value.length > MAX_TEXT_LENGTH || hasControlCharacter(value)) {
    fail(`${MANIFEST_FILE}: '${field}' must be at most ${MAX_TEXT_LENGTH} characters without control characters.`);
  }

  return value;
}

function checkRepoPath(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    fail(`${MANIFEST_FILE}: '${field}' must be a string.`);
  }
  let normalised: string;
  try {
    normalised = toRepoPath(value, field);
  } catch (error) {
    fail(`${MANIFEST_FILE}: ${(error as Error).message}`, error);
  }
  if (normalised !== value) {
    fail(
      `${MANIFEST_FILE}: '${field}' ${JSON.stringify(value)} is not in canonical form (${JSON.stringify(normalised)}).`,
    );
  }

  return normalised;
}

function checkSorted(values: readonly string[], field: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCodeUnits(values[index - 1], values[index]) >= 0) {
      fail(`${MANIFEST_FILE}: '${field}' must be sorted and free of duplicates.`);
    }
  }
}

function checkFile(value: unknown, index: number, buildDirs: readonly string[]): BundleFile {
  const field = `files[${index}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${MANIFEST_FILE}: '${field}' must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !['path', 'sha256', 'size'].includes(key));
  if (unknownKeys.length > 0) {
    fail(`${MANIFEST_FILE}: '${field}' has unknown keys: ${unknownKeys.join(', ')}.`);
  }

  const filePath = checkRepoPath(record['path'], `${field}.path`);
  if (filePath === ROOT || filePath === MANIFEST_FILE || filePath === CHECKSUMS_FILE) {
    fail(`${MANIFEST_FILE}: '${field}.path' ${JSON.stringify(filePath)} is reserved.`);
  }
  if (!buildDirs.some((directory) => isWithin(directory, filePath))) {
    fail(`${MANIFEST_FILE}: '${field}.path' ${JSON.stringify(filePath)} lies outside every build directory.`);
  }
  const sha256 = record['sha256'];
  if (typeof sha256 !== 'string' || !isSha256Hex(sha256)) {
    fail(`${MANIFEST_FILE}: '${field}.sha256' must be a lowercase hexadecimal SHA-256.`);
  }
  const size = record['size'];
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    fail(`${MANIFEST_FILE}: '${field}.size' must be a non-negative integer.`);
  }

  return { path: filePath, sha256, size };
}

/**
 * Parses and validates manifest text. Strict: an unknown key, an unsorted list, a path that is not
 * canonical or that lies outside every build directory is an error.
 *
 * @throws {@link BundleVerificationError} naming the first problem found
 */
export function parseBundleManifest(text: string): BundleManifest {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    fail(`${MANIFEST_FILE}: not valid JSON.`, error);
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    fail(`${MANIFEST_FILE}: expected a JSON object.`);
  }

  const record = document as Record<string, unknown>;
  const known = ['schema', 'sourceSha', 'toolchain', 'generatedBy', 'buildDirs', 'files'];
  const unknownKeys = Object.keys(record).filter((key) => !known.includes(key));
  if (unknownKeys.length > 0) {
    fail(`${MANIFEST_FILE}: unknown keys: ${unknownKeys.join(', ')}.`);
  }
  if (record['schema'] !== MANIFEST_SCHEMA) {
    fail(`${MANIFEST_FILE}: 'schema' must be ${MANIFEST_SCHEMA}.`);
  }
  const sourceSha = record['sourceSha'];
  if (typeof sourceSha !== 'string' || !isCommitId(sourceSha)) {
    fail(`${MANIFEST_FILE}: 'sourceSha' must be a full lowercase commit id.`);
  }
  if (!Array.isArray(record['buildDirs']) || record['buildDirs'].length === 0) {
    fail(`${MANIFEST_FILE}: 'buildDirs' must be a non-empty list.`);
  }
  const buildDirs = record['buildDirs'].map((value: unknown, index) => checkRepoPath(value, `buildDirs[${index}]`));
  checkSorted(buildDirs, 'buildDirs');
  if (!Array.isArray(record['files']) || record['files'].length === 0) {
    fail(`${MANIFEST_FILE}: 'files' must be a non-empty list.`);
  }
  const files = record['files'].map((value: unknown, index) => checkFile(value, index, buildDirs));
  checkSorted(
    files.map((file) => file.path),
    'files',
  );

  return {
    schema: MANIFEST_SCHEMA,
    sourceSha,
    toolchain: checkText(record['toolchain'], 'toolchain', { allowEmpty: true }),
    generatedBy: checkText(record['generatedBy'], 'generatedBy', { allowEmpty: false }),
    buildDirs,
    files,
  };
}

/** Metadata recorded in a manifest besides the files. */
export interface ManifestMetadata {
  readonly sourceSha: string;
  readonly toolchain: string;
  readonly generatedBy: string;
}

/** The result of staging or verifying a set of bundles. */
export interface StagedBundles {
  readonly manifest: BundleManifest;
  /** The exact bytes of `bundles.json`. */
  readonly manifestText: string;
  /** SHA-256 of {@link StagedBundles.manifestText}. */
  readonly manifestSha256: string;
  /** Absolute path of the directory holding the bundles and both manifest files. */
  readonly directory: string;
}

/** Reads a regular file, refusing a symbolic link or anything else that is not one. */
function readRegularFile(absolute: string, label: string): Buffer {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolute);
  } catch (error) {
    fail(`${label} does not exist.`, error);
  }
  if (stats.isSymbolicLink()) {
    fail(`${label} is a symbolic link.`);
  }
  if (!stats.isFile()) {
    fail(`${label} is not a regular file.`);
  }

  return fs.readFileSync(absolute);
}

/**
 * Copies built bundles into an empty staging directory at their repository paths, and writes
 * `bundles.json` and `bundles.sha256` beside them.
 *
 * Every bundle must exist as a regular file under `root` and lie below one of `buildDirs`.
 *
 * @param root - absolute path of the checkout the build ran in
 * @param buildDirs - repository-relative directories the build ran in
 * @param bundles - repository-relative bundle paths, typically a build set's `bundles`
 * @param stagingDirectory - absolute path of a directory that does not exist yet or is empty
 * @throws {@link BundleVerificationError} for a missing bundle, a symbolic link or an invalid path
 */
export function stageBundles(
  root: string,
  buildDirs: readonly string[],
  bundles: readonly string[],
  stagingDirectory: string,
  metadata: ManifestMetadata,
): StagedBundles {
  fs.mkdirSync(stagingDirectory, { recursive: true });
  if (fs.readdirSync(stagingDirectory).length > 0) {
    fail(`Staging directory ${stagingDirectory} is not empty.`);
  }

  // Every path is checked before the first file-system access: `toAbsolute` would resolve a `..`
  // segment and read or write outside the checkout and the staging directory.
  bundles.forEach((bundle, index) => checkRepoPath(bundle, `bundles[${index}]`));

  const missing = bundles.filter((bundle) => !fs.existsSync(toAbsolute(root, bundle)));
  if (missing.length > 0) {
    fail(`The build did not produce: ${missing.join(', ')}.`);
  }

  const files: BundleFile[] = sortedUnique(bundles).map((bundle) => {
    const content = readRegularFile(toAbsolute(root, bundle), bundle);
    const target = toAbsolute(stagingDirectory, bundle);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { mode: 0o644 });

    return { path: bundle, sha256: sha256Hex(content), size: content.byteLength };
  });

  const manifest = parseBundleManifest(
    serializeManifest({ schema: MANIFEST_SCHEMA, ...metadata, buildDirs: sortedUnique(buildDirs), files }),
  );
  const manifestText = serializeManifest(manifest);
  fs.writeFileSync(path.join(stagingDirectory, MANIFEST_FILE), manifestText);
  fs.writeFileSync(path.join(stagingDirectory, CHECKSUMS_FILE), renderChecksums(manifest.files));

  return { manifest, manifestText, manifestSha256: sha256Hex(manifestText), directory: stagingDirectory };
}

/** Every regular file below `directory`, as paths relative to it. Fails on any symbolic link or special file. */
function listFiles(directory: string): string[] {
  const files: string[] = [];
  const pending = [ROOT];

  while (pending.length > 0) {
    const relative = pending.pop() as string;
    for (const entry of fs.readdirSync(toAbsolute(directory, relative), { withFileTypes: true })) {
      const child = joinRepoPath(relative, entry.name);
      if (entry.isSymbolicLink()) {
        fail(`The artifact contains a symbolic link: ${child}.`);
      } else if (entry.isDirectory()) {
        pending.push(child);
      } else if (entry.isFile()) {
        files.push(child);
      } else {
        fail(`The artifact contains a special file: ${child}.`);
      }
    }
  }

  return sortedUnique(files);
}

/**
 * Verifies a downloaded artifact directory against the expected manifest hash.
 *
 * Checks, in order: `bundles.json` is a regular file whose SHA-256 is `expectedManifestSha256`; it
 * parses under the strict schema; the directory holds no symbolic link or special file; every file is
 * listed and every listed file is present; each file's size and SHA-256 match; `bundles.sha256` equals
 * the rendering of the manifest. Nothing is copied or trusted before all checks pass.
 *
 * @param directory - absolute path of the downloaded artifact
 * @param expectedManifestSha256 - SHA-256 of `bundles.json` from a trusted source
 * @throws {@link BundleVerificationError} naming the first check that failed
 */
export function verifyBundleDirectory(directory: string, expectedManifestSha256: string): StagedBundles {
  if (!isSha256Hex(expectedManifestSha256)) {
    fail('The expected manifest SHA-256 must be 64 lowercase hexadecimal characters.');
  }

  const manifestBytes = readRegularFile(path.join(directory, MANIFEST_FILE), MANIFEST_FILE);
  const manifestSha256 = sha256Hex(manifestBytes);
  if (manifestSha256 !== expectedManifestSha256) {
    fail(`${MANIFEST_FILE} has SHA-256 ${manifestSha256}, expected ${expectedManifestSha256}.`);
  }
  const manifestText = manifestBytes.toString('utf8');
  const manifest = parseBundleManifest(manifestText);

  const present = listFiles(directory).filter((file) => file !== MANIFEST_FILE && file !== CHECKSUMS_FILE);
  const listed = new Set(manifest.files.map((file) => file.path));
  const unlisted = present.filter((file) => !listed.has(file));
  if (unlisted.length > 0) {
    fail(`The artifact contains files the manifest does not list: ${unlisted.join(', ')}.`);
  }
  const absent = manifest.files.filter((file) => !present.includes(file.path)).map((file) => file.path);
  if (absent.length > 0) {
    fail(`The artifact is missing files the manifest lists: ${absent.join(', ')}.`);
  }

  for (const file of manifest.files) {
    const content = readRegularFile(toAbsolute(directory, file.path), file.path);
    if (content.byteLength !== file.size) {
      fail(`${file.path} is ${content.byteLength} bytes, the manifest says ${file.size}.`);
    }
    const digest = sha256Hex(content);
    if (digest !== file.sha256) {
      fail(`${file.path} has SHA-256 ${digest}, the manifest says ${file.sha256}.`);
    }
  }

  const checksums = readRegularFile(path.join(directory, CHECKSUMS_FILE), CHECKSUMS_FILE).toString('utf8');
  if (checksums !== renderChecksums(manifest.files)) {
    fail(`${CHECKSUMS_FILE} does not match ${MANIFEST_FILE}.`);
  }

  return { manifest, manifestText, manifestSha256, directory };
}

/** Fails when any existing component of `repoPath` below `root` is a symbolic link. */
function assertNoLinkedComponent(root: string, repoPath: string): void {
  const segments = repoPath.split('/');
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const prefix = segments.slice(0, depth).join('/');
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(toAbsolute(root, prefix));
    } catch {
      return;
    }
    if (stats.isSymbolicLink()) {
      fail(`Refusing to install through the symbolic link ${prefix} in the target checkout.`);
    }
  }
}

/**
 * The directories {@link installBundles} clears when asked to replace: each bundle's parent, when that
 * parent lies strictly below the build directory it belongs to. A bundle written directly into its
 * build directory (a root action's `index.js`) is overwritten on its own, so the action's sources are
 * never deleted.
 */
export function replaceableDirectories(manifest: BundleManifest): string[] {
  const directories = manifest.files
    .map((file) => {
      const parent = parentOf(file.path);
      // The innermost build directory owns the bundle: with `.` and `actions/x` both built, a bundle
      // at `actions/x/index.js` belongs to `actions/x`, whose directory must not be cleared.
      const owner = manifest.buildDirs
        .filter((directory) => isWithin(directory, file.path))
        .reduce<string | undefined>(
          (longest, directory) => (longest === undefined || directory.length > longest.length ? directory : longest),
          undefined,
        );

      return owner !== undefined && parent !== owner && isWithin(owner, parent) ? parent : undefined;
    })
    .filter((directory): directory is string => directory !== undefined);

  return sortedUnique(directories);
}

/**
 * Copies verified bundles into a checkout.
 *
 * @param verified - the result of {@link verifyBundleDirectory}
 * @param targetRoot - absolute path of the checkout
 * @param replace - clear {@link replaceableDirectories} first, so a stale file from a committed build
 * cannot survive next to the installed one
 * @returns the repository-relative paths written
 * @throws {@link BundleVerificationError} when a target path runs through a symbolic link
 */
export function installBundles(verified: StagedBundles, targetRoot: string, replace: boolean): string[] {
  for (const file of verified.manifest.files) {
    assertNoLinkedComponent(targetRoot, file.path);
  }

  if (replace) {
    for (const directory of replaceableDirectories(verified.manifest)) {
      fs.rmSync(toAbsolute(targetRoot, directory), { recursive: true, force: true });
    }
  }

  for (const file of verified.manifest.files) {
    const target = toAbsolute(targetRoot, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(toAbsolute(verified.directory, file.path), target);
  }

  return verified.manifest.files.map((file) => file.path);
}
