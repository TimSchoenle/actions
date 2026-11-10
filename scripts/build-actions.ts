import fs from 'node:fs';

import { buildSet, findActions, toAbsolute, toRepoPath } from 'action-graph';

import { ROOT_DIR, Sys } from './lib/utils.js';

import type { BuildSet } from 'action-graph';

/** Builds every action under this directory with `--all`. */
const ACTIONS_ROOT = 'actions';

const ALL_FLAG = '--all';

/** How one build command ended. */
export interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
}

/** Runs a command in a directory. Injected so tests need no real build. */
export type CommandRunner = (command: string[], cwd: string) => Promise<CommandResult>;

/** What a call needs from its surroundings. */
export interface BuildActionsContext {
  /** Absolute path of the repository root. */
  readonly root: string;
  readonly run: CommandRunner;
  readonly log: (line: string) => void;
}

const defaultContext: BuildActionsContext = {
  root: ROOT_DIR,
  run: (command, cwd) => Sys.run(command, cwd),
  log: (line) => console.log(line),
};

/**
 * The build set the arguments select: every action under `actions/` for `--all`, otherwise the
 * closure of the action directories given.
 *
 * @throws an `Error` for no arguments, or for `--all` combined with directories
 */
export function selectBuildSet(argv: readonly string[], root: string): BuildSet {
  const all = argv.includes(ALL_FLAG);
  const targets = argv.filter((argument) => argument !== ALL_FLAG);

  if (all === targets.length > 0) {
    throw new Error(`Pass ${ALL_FLAG} or one or more action directories, not both and not neither.`);
  }

  return buildSet(
    root,
    all ? findActions(root, { within: ACTIONS_ROOT }) : targets.map((target) => toRepoPath(target)),
  );
}

/**
 * Builds the bundles of a build set through each build directory's own `build` script, the same
 * script the release build runs, then checks that every bundle exists.
 *
 * Every bundle is deleted first, so a committed bundle cannot stand in for one a build script failed
 * to write. A failed build therefore leaves its bundle missing; rebuilding restores it.
 *
 * @returns the bundles that were built
 * @throws an `Error` naming the directory whose build failed, or the bundles no build produced
 */
export async function buildActions(set: BuildSet, context: BuildActionsContext = defaultContext): Promise<string[]> {
  for (const bundle of set.bundles) {
    fs.rmSync(toAbsolute(context.root, bundle), { force: true });
  }

  for (const directory of set.buildDirs) {
    context.log(`Building ${directory}`);
    const result = await context.run(['bun', 'run', 'build'], toAbsolute(context.root, directory));
    if (result.exitCode !== 0) {
      throw new Error(
        `${directory}: 'bun run build' failed with exit code ${result.exitCode}.\n${result.stderr.trim()}`,
      );
    }
  }

  const missing = set.bundles.filter((bundle) => !fs.existsSync(toAbsolute(context.root, bundle)));
  if (missing.length > 0) {
    throw new Error(`The build did not produce: ${missing.join(', ')}.`);
  }

  return [...set.bundles];
}

/**
 * Builds action bundles from source: `bun run build:actions --all`, or
 * `bun run build:actions actions/common/create-patch [...]` for the closure of the given actions,
 * nested helpers and local `uses:` included.
 *
 * Generated sources are not regenerated here; run `bun run generate-action-sources` first when an
 * `action.yaml` changed.
 *
 * @returns the process exit code
 */
export async function main(argv: string[] = Bun.argv.slice(2), context = defaultContext): Promise<number> {
  try {
    const built = await buildActions(selectBuildSet(argv, context.root), context);
    context.log(`Built ${built.length} bundle(s).`);

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
