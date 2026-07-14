import path from 'node:path';

import { BUNDLE_PATH, collectGeneratedModules } from './action-sources.js';
import { ROOT_DIR, Sys } from './utils.js';

/** The outcome of rebuilding one action's bundle and comparing it with the committed one. */
export interface BundleCheck {
  /** Repository-relative, POSIX-separated directory of the action. */
  actionDir: string;
  /** Repository-relative, POSIX-separated path of the bundle. */
  relativePath: string;
  /** Absolute path of the bundle. */
  absolutePath: string;
  /** True when the committed bundle differs from a fresh build of the current sources. */
  drifted: boolean;
}

/** Every Node action, deduplicated — `collectGeneratedModules` yields several modules per action. */
async function nodeActionDirs(): Promise<string[]> {
  const modules = await collectGeneratedModules();

  return [...new Set(modules.map((module) => module.actionDir))];
}

/**
 * Rebuilds one action's bundle with the action's own `build` script and reports whether the result
 * differs from the bundle that is committed.
 *
 * The action's script is invoked rather than a reimplementation of it, so that a build with extra
 * steps — `verify-commit-authors` runs GraphQL codegen first — is checked exactly as it ships.
 *
 * The build necessarily overwrites the bundle in place. When `restore` is set, the committed bytes
 * are put back afterwards, which keeps a read-only check from leaving a rewritten bundle behind in
 * the working tree.
 */
export async function checkBundle(actionDir: string, restore: boolean): Promise<BundleCheck> {
  const relativePath = `${actionDir}/${BUNDLE_PATH}`;
  const absolutePath = path.join(ROOT_DIR, relativePath);
  const file = Sys.file(absolutePath);
  const committed = (await file.exists()) ? await file.arrayBuffer() : undefined;

  const result = await Sys.run(['bun', 'run', 'build'], path.join(ROOT_DIR, actionDir));
  if (result.exitCode !== 0) {
    throw new Error(`${actionDir}: 'bun run build' failed with exit code ${result.exitCode}.\n${result.stderr.trim()}`);
  }

  const rebuilt = await Sys.file(absolutePath).arrayBuffer();
  const drifted = committed === undefined || !Buffer.from(committed).equals(Buffer.from(rebuilt));

  if (drifted && restore && committed !== undefined) {
    await Sys.write(absolutePath, committed);
  }

  return { actionDir, relativePath, absolutePath, drifted };
}

/**
 * Rebuilds the bundle of every Node action, or only of the actions the given paths belong to.
 *
 * Narrowing by path is what the pre-commit hook needs: it is handed the staged files and must not
 * pay for rebuilding actions the commit does not touch.
 */
export async function checkBundles(paths: string[], restore: boolean): Promise<BundleCheck[]> {
  const dirs = await nodeActionDirs();
  const touched =
    paths.length === 0 ? dirs : dirs.filter((dir) => paths.some((file) => toRepoRelative(file).startsWith(`${dir}/`)));

  const checks: BundleCheck[] = [];
  for (const dir of touched) {
    checks.push(await checkBundle(dir, restore));
  }

  return checks;
}

/** Normalizes a path handed over by lint-staged, which passes absolute, platform-native paths. */
export function toRepoRelative(file: string): string {
  const normalized = file.replaceAll('\\', '/');
  const root = ROOT_DIR.replaceAll('\\', '/');

  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
}
