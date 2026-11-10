/**
 * Reading the parts of an action manifest (`action.yml` / `action.yaml`) that decide what has to be
 * built for the action to run.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';

import { parse } from 'yaml';

import { InvalidPathError, joinRepoPath, ROOT, toAbsolute, toRepoPath } from './paths.js';

/**
 * Manifest file names, in the order the runner looks them up: `action.yml` wins when both exist.
 */
export const MANIFEST_FILE_NAMES = ['action.yml', 'action.yaml'] as const;

/** The bundle entry points a JavaScript action may declare under `runs`. */
export const BUNDLE_KEYS = ['pre', 'main', 'post'] as const;

/** Raised for a manifest that cannot be read or does not describe an action. */
export class ManifestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ManifestError';
  }
}

/** What this package needs to know about one action. All paths are repository-relative. */
export interface ActionManifest {
  /** The directory holding the manifest. */
  readonly directory: string;
  /** The manifest file itself. */
  readonly file: string;
  /** `runs.using`, for example `node24`, `composite` or `docker`. */
  readonly using: string;
  /**
   * The files the runner executes for a JavaScript action (`runs.pre`, `runs.main`, `runs.post`),
   * resolved against {@link ActionManifest.directory}. Empty for any other kind of action.
   */
  readonly bundles: readonly string[];
  /**
   * Every `uses: ./<path>` of a composite action's steps, as repository-relative directories. The
   * runner resolves such a reference against the workspace root, not against the action.
   */
  readonly localUses: readonly string[];
  /**
   * The bodies of a composite action's `run:` steps, which is where a helper bundle is invoked
   * (`node "$GITHUB_ACTION_PATH/helper/dist/index.js"`).
   */
  readonly runScripts: readonly string[];
}

/** Whether `runs.using` names the Node.js runtime, the only one whose action ships a bundle. */
export function isNodeRuntime(using: string): boolean {
  return /^node\d+$/.test(using);
}

/** The manifest file of `directory`, or `undefined` when it holds none. */
export function findManifestFile(root: string, directory: string): string | undefined {
  for (const name of MANIFEST_FILE_NAMES) {
    const file = joinRepoPath(directory, name);
    if (fs.existsSync(toAbsolute(root, file))) {
      return file;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The local reference a `uses:` value makes, or `undefined` for a remote or Docker one.
 *
 * `./actions/x`, `./actions/x/` and `.` are local. A local reference cannot carry `@ref`.
 */
export function localUsesPath(uses: string): string | undefined {
  const value = uses.trim();
  if (value !== '.' && !value.startsWith('./')) {
    return undefined;
  }

  return toRepoPath(value, `uses: ${JSON.stringify(value)}`);
}

function readSteps(runs: Record<string, unknown>, file: string): { localUses: string[]; runScripts: string[] } {
  const steps = runs['steps'];
  if (steps === undefined) {
    return { localUses: [], runScripts: [] };
  }
  if (!Array.isArray(steps)) {
    throw new ManifestError(`${file}: 'runs.steps' must be a list.`);
  }

  const localUses: string[] = [];
  const runScripts: string[] = [];
  for (const step of steps) {
    if (!isRecord(step)) {
      continue;
    }
    if (typeof step['uses'] === 'string') {
      const local = localUsesPath(step['uses']);
      if (local !== undefined) {
        localUses.push(local);
      }
    }
    if (typeof step['run'] === 'string') {
      runScripts.push(step['run']);
    }
  }

  return { localUses, runScripts };
}

function readBundles(runs: Record<string, unknown>, directory: string, file: string): string[] {
  const bundles: string[] = [];
  for (const key of BUNDLE_KEYS) {
    const value = runs[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ManifestError(`${file}: 'runs.${key}' must be a non-empty string.`);
    }
    try {
      bundles.push(joinRepoPath(directory, toRepoPath(value, `runs.${key}`)));
    } catch (error) {
      if (error instanceof InvalidPathError) {
        throw new ManifestError(`${file}: ${error.message}`, { cause: error });
      }
      throw error;
    }
  }

  return bundles;
}

/**
 * Parses manifest text.
 *
 * @param content - the manifest text
 * @param file - repository-relative path of the manifest, which also fixes its directory
 * @throws {@link ManifestError} when the text is not YAML, not a mapping, has no `runs.using`, or a
 * JavaScript action declares no `runs.main`
 */
export function parseActionManifest(content: string, file: string): ActionManifest {
  const manifestFile = toRepoPath(file, 'manifest path');
  const directory = manifestFile.includes('/') ? manifestFile.slice(0, manifestFile.lastIndexOf('/')) : ROOT;

  let document: unknown;
  try {
    document = parse(content);
  } catch (error) {
    throw new ManifestError(`${manifestFile}: not valid YAML: ${(error as Error).message}`, { cause: error });
  }

  const runs = isRecord(document) ? document['runs'] : undefined;
  if (!isRecord(runs) || typeof runs['using'] !== 'string' || runs['using'] === '') {
    throw new ManifestError(`${manifestFile}: 'runs.using' is missing.`);
  }

  const using = runs['using'];
  const node = isNodeRuntime(using);
  const bundles = node ? readBundles(runs, directory, manifestFile) : [];
  if (node && runs['main'] === undefined) {
    throw new ManifestError(`${manifestFile}: runs on '${using}' but declares no 'runs.main'.`);
  }
  const steps = using === 'composite' ? readSteps(runs, manifestFile) : { localUses: [], runScripts: [] };

  return { directory, file: manifestFile, using, bundles, ...steps };
}

/**
 * Reads and parses the manifest of `directory`.
 *
 * @param root - absolute path of the repository root
 * @param directory - repository-relative directory of the action
 * @throws {@link ManifestError} when the directory holds no manifest, or the manifest is invalid
 */
export function readActionManifest(root: string, directory: string): ActionManifest {
  const actionDirectory = toRepoPath(directory, 'action directory');
  const file = findManifestFile(root, actionDirectory);
  if (file === undefined) {
    throw new ManifestError(`${actionDirectory}: no ${MANIFEST_FILE_NAMES.join(' or ')} found.`);
  }

  return parseActionManifest(fs.readFileSync(toAbsolute(root, file), 'utf8'), file);
}
