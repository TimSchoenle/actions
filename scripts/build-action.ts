import path from 'node:path';

import { BUNDLE_PATH, ENTRY_MODULE_PATH } from './lib/action-sources.js';
import { ROOT_DIR, Sys } from './lib/utils.js';

/** How one CommonJS module-path variable is bound to the bundle's own location at runtime. */
interface ModulePathBinding {
  /** The CommonJS free variable a dependency reads. */
  readonly variable: '__dirname' | '__filename';
  /** The free identifier the bundler substitutes for it. */
  readonly identifier: string;
  /** Matches a reference to `identifier` as a whole word. */
  readonly reference: RegExp;
  /** The ES module expression the identifier is bound to. */
  readonly expression: string;
}

/**
 * Runtime bindings for the CommonJS `__dirname` / `__filename` free variables.
 *
 * Bundled to an ES module, a CommonJS dependency that reads `__dirname` (as `@actions/tool-cache` did)
 * gets the absolute path of its build-time source directory inlined as a string. That path differs per
 * checkout, which breaks the byte-for-byte freshness check, and it is wrong at runtime, where the code
 * runs from `dist/`. Defining each variable as a plain identifier and binding that identifier from
 * `import.meta` resolves it to the bundle's own location instead. The variables cannot be defined as
 * `import.meta.*` directly: Bun inlines a define value that is not an identifier as a string literal.
 */
const MODULE_PATH_BINDINGS: readonly ModulePathBinding[] = [
  {
    variable: '__dirname',
    identifier: '__bundleDirname',
    reference: /\b__bundleDirname\b/,
    expression: 'import.meta.dirname',
  },
  {
    variable: '__filename',
    identifier: '__bundleFilename',
    reference: /\b__bundleFilename\b/,
    expression: 'import.meta.filename',
  },
];

/**
 * The bundler flags every Node action is built with, defined in exactly one place.
 *
 * The release builds every bundle twice, on separate runners, and publishes only when both builds are
 * byte-for-byte identical. That only holds if every action bundles with the same flags, so they live
 * here rather than in thirteen copies of a package.json string that could drift apart unnoticed.
 *
 * `--target node` matches the `node24` runtime GitHub provides. `--minify` is deterministic within a
 * Bun version — which is what the version guard below pins — and shrinks the published bundle.
 * The `--define`s keep the bundle independent of where it was built; see {@link MODULE_PATH_BINDINGS}.
 * `process.env.NODE_ENV` is fixed to `production` for the same reason: otherwise a dependency's check
 * is inlined from the build job's environment, which both release builds share, so the byte
 * comparison between them cannot catch it.
 */
const BUILD_FLAGS: readonly string[] = [
  '--target',
  'node',
  '--minify',
  '--define',
  'process.env.NODE_ENV="production"',
  ...MODULE_PATH_BINDINGS.flatMap(({ variable, identifier }) => ['--define', `${variable}=${identifier}`]),
];

/**
 * Prepends a declaration for each {@link MODULE_PATH_BINDINGS} identifier the bundle references.
 *
 * Only referenced bindings are declared, so a bundle whose dependencies never read `__dirname` or
 * `__filename` (or whose reads were tree-shaken) keeps its exact bytes. Minified identifiers are
 * short, so the `__bundle*` names cannot collide with a declaration of the bundle's own.
 */
export function bindModulePaths(bundle: string): string {
  const declarations = MODULE_PATH_BINDINGS.filter(({ reference }) => reference.test(bundle)).map(
    ({ identifier, expression }) => `${identifier}=${expression}`,
  );

  return declarations.length === 0 ? bundle : `const ${declarations.join(',')};\n${bundle}`;
}

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
      'The bundle you build may differ byte-for-byte from the one the release builds. ' +
      `Install the pinned Bun before comparing bundles (e.g. 'bun upgrade --to ${pinned}').`,
  );

  return true;
}

/**
 * Builds one action's bundle from its generated entry point to the bundle `runs.main` references.
 *
 * The entry point and outfile are the repository-wide constants every generated source and freshness
 * check already assumes, so an action cannot bundle from or to a non-standard path. Output is
 * inherited rather than captured so `bun run build:workspaces` still reports each action's build.
 * The written bundle then gets its module-path bindings ({@link bindModulePaths}).
 */
export async function buildAction(actionDir: string): Promise<void> {
  const command = ['bun', 'build', `./${ENTRY_MODULE_PATH}`, '--outfile', `./${BUNDLE_PATH}`, ...BUILD_FLAGS];
  const proc = Bun.spawn(command, { cwd: actionDir, stdout: 'inherit', stderr: 'inherit' });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${actionDir}: 'bun build' failed with exit code ${exitCode}.`);
  }

  const bundlePath = path.join(actionDir, BUNDLE_PATH);
  const bundle = await Sys.file(bundlePath).text();
  const bound = bindModulePaths(bundle);
  if (bound !== bundle) {
    await Sys.write(bundlePath, bound);
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
