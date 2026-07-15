import path from 'node:path';

import { BUNDLE_PATH, ENTRY_MODULE_PATH } from './lib/action-sources.js';
import { ROOT_DIR, Sys } from './lib/utils.js';

/**
 * The bundler flags every Node action is built with, defined in exactly one place.
 *
 * GitHub runs the committed `dist/index.js`, and the bundle freshness check (`check-action-dist`)
 * rebuilds it and compares byte-for-byte. That comparison only holds if every action bundles with
 * the same flags, so they live here rather than in thirteen copies of a package.json string that
 * could drift apart unnoticed.
 *
 * `--target node` matches the `node20` runtime GitHub provides. `--minify` is deterministic within a
 * Bun version — which is what the version guard below pins — and shrinks the committed artifact.
 */
const BUILD_FLAGS = ['--target', 'node', '--minify'] as const;

/** File pinning the Bun version, relative to the repository root. Read by CI's Bun setup too. */
const BUN_VERSION_FILE = '.bun-version';

/** The pinned Bun version, or `undefined` when the repository does not pin one. */
async function pinnedBunVersion(): Promise<string | undefined> {
  const file = Sys.file(path.join(ROOT_DIR, BUN_VERSION_FILE));

  return (await file.exists()) ? (await file.text()).trim() : undefined;
}

/**
 * Warns — but does not fail — when the running Bun differs from the pinned one.
 *
 * Bun's minifier renames identifiers between releases, so a bundle built with a different Bun can
 * differ byte-for-byte from the one CI builds and commits, which then fails the freshness check.
 * The pinned Bun is the only one guaranteed to reproduce the committed bytes; building with another
 * is allowed here so a contributor is not blocked, but it is called out so the divergence is not a
 * surprise when CI rejects the bundle.
 *
 * @returns whether a mismatch was reported, so callers (and tests) can observe the outcome.
 */
export function warnOnBunVersionDrift(running: string, pinned: string | undefined): boolean {
  if (pinned === undefined || running === pinned) {
    return false;
  }

  console.warn(
    `⚠️ Bun ${running} does not match the pinned ${pinned} (${BUN_VERSION_FILE}). ` +
      'The bundle you build may differ byte-for-byte from the one CI builds and commits. ' +
      `Install the pinned Bun before committing a bundle (e.g. 'bun upgrade --to ${pinned}').`,
  );

  return true;
}

/**
 * Builds one action's bundle from its generated entry point to the bundle `runs.main` references.
 *
 * The entry point and outfile are the repository-wide constants every generated source and freshness
 * check already assumes, so an action cannot bundle from or to a non-standard path. Output is
 * inherited rather than captured so `bun run build:workspaces` still reports each action's build.
 */
export async function buildAction(actionDir: string): Promise<void> {
  const command = ['bun', 'build', `./${ENTRY_MODULE_PATH}`, '--outfile', `./${BUNDLE_PATH}`, ...BUILD_FLAGS];
  const proc = Bun.spawn(command, { cwd: actionDir, stdout: 'inherit', stderr: 'inherit' });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${actionDir}: 'bun build' failed with exit code ${exitCode}.`);
  }
}

/**
 * Builds the action in the given directory, defaulting to the working directory.
 *
 * Every action's `build` script delegates here, and both `bun run build:workspaces` and the freshness
 * check invoke that script with the action directory as the working directory — so no argument is
 * needed in normal use, and the explicit form stays available for building one action by path.
 *
 * @returns the process exit code.
 */
export async function main(argv: string[] = Bun.argv.slice(2)): Promise<number> {
  const actionDir = argv[0] ?? process.cwd();

  warnOnBunVersionDrift(Bun.version, await pinnedBunVersion());
  await buildAction(actionDir);

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
