import path from 'node:path';

import { parse } from 'yaml';

import { ROOT_DIR, Sys } from './utils.js';

/**
 * Directory holding every file this generator writes, relative to the action directory.
 *
 * Keeping the generated sources in one place is what lets ESLint and Prettier ignore them wholesale
 * — `**\/src/generated/` is listed in both — so a rendered file only has to compile, not to survive
 * a formatter that would otherwise rewrite it into permanent drift.
 */
export const GENERATED_DIR = 'src/generated';

/** Path of the generated typed I/O module, relative to the action directory. */
export const GENERATED_MODULE_PATH = `${GENERATED_DIR}/action-io.ts`;

/** Path of the generated bundler entry point, relative to the action directory. */
export const ENTRY_MODULE_PATH = `${GENERATED_DIR}/index.ts`;

/** Module the generated entry point imports `run` from, relative to the action directory. */
export const ACTION_MODULE_PATH = 'src/action.ts';

/** The bundle `runs.main` must reference and the build script must emit. */
export const BUNDLE_PATH = 'dist/index.js';

/** The source `runs.main` is bundled from. */
const BUNDLE_ENTRY = `./${ENTRY_MODULE_PATH}`;

/** Glob matching every action manifest in the repository. */
const ACTION_MANIFEST_GLOB = 'actions/**/action.{yml,yaml}';

/**
 * Input and output names must be embedded as TypeScript string literals, so anything that could
 * break out of a quoted literal is rejected instead of escaped: a name outside this set is a typo
 * in `action.yaml`, not something worth generating code for.
 */
const IO_NAME_PATTERN = /^[A-Za-z_][\w-]*$/;

/** The entry point `bun build` bundles, e.g. `./src/index.ts` in `bun build ./src/index.ts ...`. */
const BUILD_ENTRY_PATTERN = /bun build\s+(\S+)/;

/** The bundle `bun build` writes, e.g. `./dist/index.js` in `... --outfile ./dist/index.js`. */
const BUILD_OUTFILE_PATTERN = /--outfile\s+(\S+)/;

/** The parts of an `action.yaml` the generator derives its types from. */
export interface ActionDefinition {
  inputs: string[];
  outputs: string[];
  using: string;
  /** `runs.main`, or undefined when the manifest does not declare one. */
  main: string | undefined;
}

/** The parts of an action's `package.json` that must agree with its manifest. */
export interface ActionPackage {
  main?: unknown;
  scripts?: { build?: unknown };
}

/** A generated file, paired with whatever is currently committed at its location. */
export interface GeneratedModule {
  /** Repository-relative, POSIX-separated directory of the action. */
  actionDir: string;
  /** Absolute path of the generated file. */
  absolutePath: string;
  /** Repository-relative, POSIX-separated path of the generated file. */
  relativePath: string;
  /** Content the current `action.yaml` implies. */
  expected: string;
  /** Content on disk, or `undefined` when the file has not been generated yet. */
  current: string | undefined;
}

interface RawActionManifest {
  inputs?: unknown;
  outputs?: unknown;
  runs?: { using?: unknown; main?: unknown };
}

/**
 * Only JavaScript actions have TypeScript sources to type. Composite actions declare the same
 * `inputs`/`outputs` but consume them through `${{ inputs.* }}` expressions, which the compiler
 * never sees.
 */
export function isNodeAction(using: string): boolean {
  return using.startsWith('node');
}

function readIoNames(section: unknown, kind: 'input' | 'output', source: string): string[] {
  if (section === undefined || section === null) {
    return [];
  }

  if (typeof section !== 'object' || Array.isArray(section)) {
    throw new Error(`${source}: '${kind}s' must be a mapping of ${kind} names.`);
  }

  const names = Object.keys(section as Record<string, unknown>);
  for (const name of names) {
    if (!IO_NAME_PATTERN.test(name)) {
      throw new Error(
        `${source}: '${name}' is not a usable ${kind} name. Expected a letter or underscore followed by letters, digits, underscores or dashes.`,
      );
    }
  }

  return names;
}

/**
 * Extracts the inputs, outputs, runtime and entry point from an action manifest.
 *
 * Declaration order is preserved so that a reordering in `action.yaml` produces a readable diff in
 * the generated module rather than a reshuffled one.
 */
export function parseActionDefinition(content: string, source: string): ActionDefinition {
  let manifest: unknown;
  try {
    manifest = parse(content);
  } catch (error) {
    throw new Error(`${source}: could not be parsed as YAML. ${error instanceof Error ? error.message : ''}`.trim(), {
      cause: error,
    });
  }

  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error(`${source}: expected a YAML mapping at the top level.`);
  }

  const { inputs, outputs, runs } = manifest as RawActionManifest;
  const using = runs?.using;
  const main = runs?.main;

  if (typeof using !== 'string' || using === '') {
    throw new Error(`${source}: 'runs.using' is missing. Every action must declare its runtime.`);
  }

  if (main !== undefined && typeof main !== 'string') {
    throw new Error(`${source}: 'runs.main' must be a string.`);
  }

  return {
    inputs: readIoNames(inputs, 'input', source),
    outputs: readIoNames(outputs, 'output', source),
    using,
    main,
  };
}

/** Strips a leading `./` so that `./dist/index.js` and `dist/index.js` compare equal. */
function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Reports every way an action's manifest, package manifest and entry point fail to line up.
 *
 * GitHub runs the committed bundle at `runs.main` — not the TypeScript sources — so the chain from
 * `src/index.ts` through the build script to `runs.main` has to be exact. A build that writes
 * somewhere other than `runs.main` points at, or a manifest that points at a bundle nothing emits,
 * produces an action that silently runs stale code or none at all. Standardizing all three on the
 * same paths is what lets the generated entry point and the bundle freshness check assume them.
 *
 * Problems are collected rather than thrown one at a time, so a misconfigured action is reported in
 * full instead of one fix per run.
 */
export function checkActionStructure(
  definition: ActionDefinition,
  packageJson: ActionPackage | undefined,
  source: string,
): string[] {
  const problems: string[] = [];

  if (definition.main === undefined) {
    problems.push(`${source}: 'runs.main' is missing. A Node action must declare its bundle.`);
  } else if (normalizePath(definition.main) !== BUNDLE_PATH) {
    problems.push(`${source}: 'runs.main' is '${definition.main}', expected '${BUNDLE_PATH}'.`);
  }

  if (packageJson === undefined) {
    problems.push(`${source}: no package.json next to the manifest — a Node action needs one to build its bundle.`);
    return problems;
  }

  if (normalizePath(String(packageJson.main ?? '')) !== BUNDLE_PATH) {
    problems.push(`${source}: package.json 'main' is '${String(packageJson.main ?? '')}', expected '${BUNDLE_PATH}'.`);
  }

  const build = packageJson.scripts?.build;
  if (typeof build !== 'string' || build === '') {
    problems.push(`${source}: package.json has no 'build' script to produce ${BUNDLE_PATH}.`);
    return problems;
  }

  const entry = BUILD_ENTRY_PATTERN.exec(build)?.[1];
  if (entry === undefined) {
    problems.push(`${source}: the 'build' script does not invoke 'bun build'.`);
  } else if (normalizePath(entry) !== ENTRY_MODULE_PATH) {
    problems.push(`${source}: the 'build' script bundles '${entry}', expected '${BUNDLE_ENTRY}'.`);
  }

  const outfile = BUILD_OUTFILE_PATTERN.exec(build)?.[1];
  if (outfile === undefined) {
    problems.push(`${source}: the 'build' script does not pass '--outfile'.`);
  } else if (normalizePath(outfile) !== BUNDLE_PATH) {
    problems.push(`${source}: the 'build' script writes '${outfile}', but 'runs.main' points at '${BUNDLE_PATH}'.`);
  }

  return problems;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

/**
 * Renders the names as a frozen lookup object whose values are their own keys.
 *
 * A `const` object merged with a union type — rather than an `enum` — keeps the generated names
 * identical to the ones in `action.yaml`: an enum member has to be a valid identifier, which would
 * force a second naming layer for names like `old-value` and let `old_value` and `old-value` collide.
 * It also leaves plain string literals assignable (an enum is nominal) and exposes the declared
 * names at runtime via `Object.values`.
 */
function renderLookup(name: string, names: string[]): string {
  const entries = names
    .map((entry) => `  ${IDENTIFIER_PATTERN.test(entry) ? entry : `'${entry}'`}: '${entry}',`)
    .join('\n');

  return `export const ${name} = {${entries === '' ? '' : `\n${entries}\n`}} as const;

export type ${name} = (typeof ${name})[keyof typeof ${name}];`;
}

/**
 * Renders the typed `@actions/core` facade for a single action.
 *
 * Only the declared names are generated. The accessors themselves are identical in every action, so
 * they live in `actions-util` (`createActionIo`) and are bound here to this action's name unions —
 * emitting them ten times over is duplication a generator makes cheap to produce and no cheaper to
 * review.
 */
export function renderModule(definition: ActionDefinition, actionDir: string): string {
  return `/**
 * Typed \`@actions/core\` accessors for the inputs and outputs declared in \`${actionDir}/action.yaml\`.
 *
 * AUTO-GENERATED by \`bun run generate-action-sources\`. Do not edit — regenerate instead.
 *
 * Reading an input or writing an output that \`action.yaml\` does not declare is a compile error. To
 * keep that guarantee, action sources must not call \`@actions/core\` for I/O directly; ESLint
 * enforces this.
 *
 * Every input is a \`string\`: that is what the runner hands over, and inferring a type from an
 * input's default would take over validation that belongs to \`@actions/core\`.
 */
import { createActionIo } from 'actions-util';

/** Every input declared in \`action.yaml\`. Usable as a value (\`ActionInput.x\`) and as a type. */
${renderLookup('ActionInput', definition.inputs)}

/** Every output declared in \`action.yaml\`. Usable as a value (\`ActionOutput.x\`) and as a type. */
${renderLookup('ActionOutput', definition.outputs)}

export const { getBooleanInput, getInput, getMultilineInput, setOutput } = createActionIo<ActionInput, ActionOutput>();
`;
}

/**
 * Renders the bundler entry point for a single action.
 *
 * Every Node action is bundled from the same file, so that file is generated rather than copied: it
 * carries no logic, which keeps `action.ts` importable — and therefore testable — without running
 * the action as an import side effect. `await` covers a synchronous `run` just as well as an
 * asynchronous one, so both shapes bundle from one template.
 */
export function renderEntryModule(actionDir: string): string {
  return `/**
 * Entry point of \`${actionDir}\`, bundled to \`${BUNDLE_PATH}\` and run by GitHub via \`runs.main\`.
 *
 * AUTO-GENERATED by \`bun run generate-action-sources\`. Do not edit — regenerate instead.
 *
 * Deliberately free of logic: \`${ACTION_MODULE_PATH}\` stays importable, and therefore testable,
 * without running the action as an import side effect.
 */
import { run } from '../action.js';

await run();
`;
}

function toPosix(value: string): string {
  return value.replaceAll('\\', '/');
}

async function readPackageJson(actionDir: string, source: string): Promise<ActionPackage | undefined> {
  const file = Sys.file(path.join(ROOT_DIR, actionDir, 'package.json'));

  if (!(await file.exists())) {
    return undefined;
  }

  try {
    return (await file.json()) as ActionPackage;
  } catch (error) {
    throw new Error(
      `${source}: package.json could not be parsed. ${error instanceof Error ? error.message : ''}`.trim(),
      {
        cause: error,
      },
    );
  }
}

async function generatedModule(actionDir: string, relativePath: string, expected: string): Promise<GeneratedModule> {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  const file = Sys.file(absolutePath);

  return {
    actionDir,
    absolutePath,
    relativePath,
    expected,
    current: (await file.exists()) ? await file.text() : undefined,
  };
}

/**
 * Discovers every Node-based action and renders its generated sources, alongside what is on disk.
 *
 * Discovery is driven by the manifests themselves, so an action becomes covered the moment its
 * `action.yaml` declares a Node runtime — there is no list to keep in sync. The structure of each
 * action is validated here rather than in a separate pass, so generating and checking enforce the
 * same contract.
 */
export async function collectGeneratedModules(): Promise<GeneratedModule[]> {
  const modules: GeneratedModule[] = [];
  const problems: string[] = [];

  for await (const manifest of Sys.glob(ACTION_MANIFEST_GLOB).scan({ cwd: ROOT_DIR })) {
    const manifestPath = toPosix(manifest);
    if (manifestPath.includes('node_modules/')) {
      continue;
    }

    const definition = parseActionDefinition(await Sys.file(path.join(ROOT_DIR, manifest)).text(), manifestPath);
    if (!isNodeAction(definition.using)) {
      continue;
    }

    const actionDir = toPosix(path.dirname(manifest));

    problems.push(...checkActionStructure(definition, await readPackageJson(actionDir, manifestPath), manifestPath));

    if (!Sys.exists(path.join(ROOT_DIR, actionDir, ACTION_MODULE_PATH))) {
      problems.push(
        `${manifestPath}: runs on '${definition.using}' but has no ${ACTION_MODULE_PATH} exporting 'run' for ${ENTRY_MODULE_PATH} to call.`,
      );
      continue;
    }

    modules.push(
      await generatedModule(actionDir, `${actionDir}/${GENERATED_MODULE_PATH}`, renderModule(definition, actionDir)),
      await generatedModule(actionDir, `${actionDir}/${ENTRY_MODULE_PATH}`, renderEntryModule(actionDir)),
    );
  }

  if (problems.length > 0) {
    throw new Error(`Action structure is invalid:\n  ${problems.join('\n  ')}`);
  }

  return modules.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** Modules whose committed content no longer matches their `action.yaml`. */
export function findStaleModules(modules: GeneratedModule[]): GeneratedModule[] {
  return modules.filter((module) => module.current !== module.expected);
}
