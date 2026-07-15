import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACTION_MODULE_PATH,
  BUNDLE_PATH,
  checkActionStructure,
  ENTRY_MODULE_PATH,
  findStaleModules,
  GENERATED_MODULE_PATH,
  isNodeAction,
  parseActionDefinition,
  renderEntryModule,
  renderModule,
} from '../action-sources';

import type { ActionDefinition, ActionPackage, GeneratedModule } from '../action-sources';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const MANIFEST = `
name: 'Example'
description: 'An example action'
inputs:
  branch_pattern:
    description: 'A pattern'
    required: true
  reject_forks:
    description: 'A flag'
    required: false
    default: 'true'
outputs:
  verified:
    description: 'The verdict'
runs:
  using: 'node20'
  main: 'dist/index.js'
`;

/** The `build` script `checkActionStructure` expects for an action whose manifest sits at `action.yaml`. */
const SHARED_BUILD = 'bun run scripts/build-action.ts';

const VALID_PACKAGE: ActionPackage = {
  main: 'dist/index.js',
  scripts: {
    build: SHARED_BUILD,
  },
};

function definitionWith(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return { inputs: [], outputs: [], using: 'node20', main: BUNDLE_PATH, ...overrides };
}

function packageWith(build: string): ActionPackage {
  return { main: BUNDLE_PATH, scripts: { build } };
}

function moduleWith(current: string | undefined, expected: string): GeneratedModule {
  return {
    actionDir: 'actions/example/action',
    absolutePath: '/repo/actions/example/action/src/generated/action-io.ts',
    relativePath: 'actions/example/action/src/generated/action-io.ts',
    current,
    expected,
  };
}

describe('isNodeAction', () => {
  it.each(['node20', 'node24'])('treats %s as a Node action', (using) => {
    expect(isNodeAction(using)).toBe(true);
  });

  it.each(['composite', 'docker'])('does not treat %s as a Node action', (using) => {
    expect(isNodeAction(using)).toBe(false);
  });
});

describe('parseActionDefinition', () => {
  it('extracts the inputs, outputs, runtime and entry point', () => {
    expect(parseActionDefinition(MANIFEST, 'action.yaml')).toEqual({
      inputs: ['branch_pattern', 'reject_forks'],
      outputs: ['verified'],
      using: 'node20',
      main: 'dist/index.js',
    });
  });

  it('preserves declaration order so regenerating produces a readable diff', () => {
    const reordered = parseActionDefinition(
      `inputs:\n  b:\n    description: 'b'\n  a:\n    description: 'a'\nruns:\n  using: 'node20'`,
      'action.yaml',
    );

    expect(reordered.inputs).toEqual(['b', 'a']);
  });

  it('reports an action without inputs or outputs as empty rather than failing', () => {
    expect(parseActionDefinition(`runs:\n  using: 'composite'`, 'action.yaml')).toEqual({
      inputs: [],
      outputs: [],
      using: 'composite',
      main: undefined,
    });
  });

  it('rejects a manifest without a runtime', () => {
    expect(() => parseActionDefinition(`name: 'Example'`, 'action.yaml')).toThrow(/'runs.using' is missing/);
  });

  it('rejects a non-string entry point', () => {
    expect(() => parseActionDefinition(`runs:\n  using: 'node20'\n  main: 42`, 'action.yaml')).toThrow(
      /'runs.main' must be a string/,
    );
  });

  it('rejects a manifest that is not a mapping', () => {
    expect(() => parseActionDefinition(`- one\n- two`, 'action.yaml')).toThrow(/expected a YAML mapping/);
  });

  it('rejects unparseable YAML', () => {
    expect(() => parseActionDefinition(`inputs: [unclosed`, 'action.yaml')).toThrow(/could not be parsed as YAML/);
  });

  it('rejects an inputs section that is not a mapping', () => {
    expect(() => parseActionDefinition(`inputs:\n  - a\nruns:\n  using: 'node20'`, 'action.yaml')).toThrow(
      /'inputs' must be a mapping/,
    );
  });

  // A name that cannot be embedded in a TypeScript string literal must fail the generator rather
  // than produce a module that does not compile — or, worse, one that compiles into something else.
  it.each(["a' | 'b", 'has space', '1_leading_digit', 'quote"name'])('rejects the unusable name %j', (name) => {
    expect(() =>
      parseActionDefinition(
        `inputs:\n  ${JSON.stringify(name)}:\n    description: 'x'\nruns:\n  using: 'node20'`,
        'action.yaml',
      ),
    ).toThrow(/is not a usable input name/);
  });
});

describe('checkActionStructure', () => {
  it('accepts an action whose manifest, package and build agree', () => {
    expect(checkActionStructure(definitionWith(), VALID_PACKAGE, 'action.yaml')).toEqual([]);
  });

  // Every action bundles through one shared builder, so the delegation is resolved relative to the
  // action's own directory: from a nested action the shared script is several levels up.
  it('accepts the delegation resolved relative to a nested action directory', () => {
    const nested = packageWith('bun run ../../../scripts/build-action.ts');

    expect(checkActionStructure(definitionWith(), nested, 'actions/common/example/action.yaml')).toEqual([]);
  });

  it('rejects a manifest without an entry point', () => {
    expect(checkActionStructure(definitionWith({ main: undefined }), VALID_PACKAGE, 'action.yaml')).toEqual([
      expect.stringContaining("'runs.main' is missing"),
    ]);
  });

  it('rejects a manifest pointing somewhere other than the standard bundle', () => {
    expect(checkActionStructure(definitionWith({ main: 'dist/main.js' }), VALID_PACKAGE, 'action.yaml')).toEqual([
      expect.stringContaining("'runs.main' is 'dist/main.js', expected 'dist/index.js'"),
    ]);
  });

  it('rejects a Node action without a package.json', () => {
    expect(checkActionStructure(definitionWith(), undefined, 'action.yaml')).toEqual([
      expect.stringContaining('no package.json'),
    ]);
  });

  it('rejects a package.json without a build script', () => {
    expect(checkActionStructure(definitionWith(), { main: BUNDLE_PATH }, 'action.yaml')).toEqual([
      expect.stringContaining("no 'build' script"),
    ]);
  });

  // The failure this check exists for: an action that bundles itself — with its own entry point,
  // outfile or flags — instead of delegating to the shared builder ships a bundle built differently
  // from every other action, which the byte-for-byte freshness check cannot vouch for.
  it('rejects a build script that does not delegate to the shared builder', () => {
    const inline = packageWith('bun build ./src/generated/index.ts --outfile ./dist/index.js --target node --minify');

    expect(checkActionStructure(definitionWith(), inline, 'action.yaml')).toEqual([
      expect.stringContaining("expected 'bun run scripts/build-action.ts'"),
    ]);
  });

  // A delegation with the wrong depth points at a path that is not the shared builder, so it is
  // rejected just like a hand-rolled build — the expected invocation names the correct depth.
  it('rejects a delegation whose relative depth does not reach the shared builder', () => {
    const wrongDepth = packageWith('bun run scripts/build-action.ts');

    expect(checkActionStructure(definitionWith(), wrongDepth, 'actions/common/example/action.yaml')).toEqual([
      expect.stringContaining("expected 'bun run ../../../scripts/build-action.ts'"),
    ]);
  });

  it('reports every problem at once rather than one per run', () => {
    const broken: ActionPackage = { main: 'index.js', scripts: { build: 'tsc' } };

    // runs.main, package.json main, and the build script that does not delegate to the shared builder.
    expect(checkActionStructure(definitionWith({ main: 'main.js' }), broken, 'action.yaml')).toHaveLength(3);
  });
});

describe('renderModule', () => {
  it('renders the declared names as a lookup object merged with a union type', () => {
    const rendered = renderModule(parseActionDefinition(MANIFEST, 'action.yaml'), 'actions/example/action');

    expect(rendered).toContain(
      "export const ActionInput = {\n  branch_pattern: 'branch_pattern',\n  reject_forks: 'reject_forks',\n} as const;",
    );
    expect(rendered).toContain('export type ActionInput = (typeof ActionInput)[keyof typeof ActionInput];');
    expect(rendered).toContain("export const ActionOutput = {\n  verified: 'verified',\n} as const;");
    expect(rendered).toContain('actions/example/action/action.yaml');
    expect(rendered.endsWith('\n')).toBe(true);
  });

  // The accessors are identical in every action, so they are bound from `actions-util` rather than
  // re-emitted per action. Reaching for `@actions/core` here would put that back.
  it('binds the shared accessors to the declared names instead of re-emitting them', () => {
    const rendered = renderModule(parseActionDefinition(MANIFEST, 'action.yaml'), 'actions/example/action');

    expect(rendered).toContain("import { createActionIo } from 'actions-util';");
    expect(rendered).toContain(
      'export const { getBooleanInput, getInput, getMultilineInput, setOutput } = createActionIo<ActionInput, ActionOutput>();',
    );
    expect(rendered).not.toContain("from '@actions/core'");
  });

  // A name that is not a valid identifier — `modify-yaml` declares `old-value` — must stay verbatim
  // rather than be mapped to a generated identifier, so it is emitted as a quoted key.
  it('quotes a name that is not a valid identifier', () => {
    const rendered = renderModule(definitionWith({ outputs: ['old-value'] }), 'actions/example/action');

    expect(rendered).toContain("export const ActionOutput = {\n  'old-value': 'old-value',\n} as const;");
  });

  // An empty lookup makes the union `never`, so every call site is a compile error — the correct
  // contract for an action that declares no inputs (or no outputs) at all.
  it('renders an empty lookup for an action without inputs or outputs', () => {
    const rendered = renderModule(definitionWith(), 'actions/example/action');

    expect(rendered).toContain('export const ActionInput = {} as const;');
    expect(rendered).toContain('export const ActionOutput = {} as const;');
  });

  it('is deterministic', () => {
    const definition = parseActionDefinition(MANIFEST, 'action.yaml');

    expect(renderModule(definition, 'actions/example/action')).toBe(renderModule(definition, 'actions/example/action'));
  });
});

describe('renderEntryModule', () => {
  // The entry point must stay free of logic: anything it did would run on import, which is exactly
  // what keeping `run` in action.ts avoids.
  // The entry point sits in src/generated, so it reaches one level up for the action module.
  it('renders an entry point that only awaits run', () => {
    const rendered = renderEntryModule('actions/example/action');

    expect(rendered).toContain("import { run } from '../action.js';");
    expect(rendered).toContain('await run();');
    expect(rendered).toContain('AUTO-GENERATED');
    expect(rendered.endsWith('\n')).toBe(true);
  });

  // `await` is what lets one template serve a synchronous and an asynchronous `run` alike. A bare
  // call would let an asynchronous action report success before it finished.
  it('awaits run rather than calling it bare', () => {
    expect(renderEntryModule('actions/example/action')).not.toMatch(/^run\(\);$/m);
  });

  it('is deterministic', () => {
    expect(renderEntryModule('actions/example/action')).toBe(renderEntryModule('actions/example/action'));
  });
});

describe('findStaleModules', () => {
  it('reports a module that has never been generated', () => {
    expect(findStaleModules([moduleWith(undefined, 'expected')])).toHaveLength(1);
  });

  it('reports a module that no longer matches its action.yaml', () => {
    expect(findStaleModules([moduleWith('outdated', 'expected')])).toHaveLength(1);
  });

  it('ignores a module that is up to date', () => {
    expect(findStaleModules([moduleWith('expected', 'expected')])).toHaveLength(0);
  });
});

/**
 * Discovers the action manifests with `node:fs` rather than `collectGeneratedModules`, whose `Sys`
 * layer needs Bun globals that vitest's Node workers do not provide. Rediscovering them here also
 * means the checks below verify the generator against the repository rather than against itself.
 */
function findActionManifests(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'dist' ? [] : findActionManifests(entryPath);
    }

    return entry.name === 'action.yaml' || entry.name === 'action.yml' ? [entryPath] : [];
  });
}

const nodeActionDirs = findActionManifests(path.join(REPO_ROOT, 'actions'))
  .filter((manifest) => isNodeAction(parseActionDefinition(readFileSync(manifest, 'utf8'), manifest).using))
  .map((manifest) => path.dirname(manifest));

function relativeDir(actionDir: string): string {
  return path.relative(REPO_ROOT, actionDir).replaceAll('\\', '/');
}

describe('the committed action sources', () => {
  it('cover at least one Node-based action', () => {
    expect(nodeActionDirs.length).toBeGreaterThan(0);
  });

  // The guard that makes the compile-time check trustworthy: if this fails, an action.yaml changed
  // without its module being regenerated, so tsc has been checking against a stale contract.
  it.each(nodeActionDirs)('%s has an I/O module matching its action.yaml', (actionDir) => {
    const modulePath = path.join(actionDir, GENERATED_MODULE_PATH);

    expect(existsSync(modulePath), `${modulePath} is missing — run 'bun run generate-action-sources'`).toBe(true);

    const manifest = readFileSync(path.join(actionDir, 'action.yaml'), 'utf8');
    const expected = renderModule(parseActionDefinition(manifest, relativeDir(actionDir)), relativeDir(actionDir));

    expect(readFileSync(modulePath, 'utf8'), "Run 'bun run generate-action-sources' and commit the result").toBe(
      expected,
    );
  });

  it.each(nodeActionDirs)('%s has the standard entry point', (actionDir) => {
    const entryPath = path.join(actionDir, ENTRY_MODULE_PATH);

    expect(existsSync(entryPath), `${entryPath} is missing — run 'bun run generate-action-sources'`).toBe(true);
    expect(readFileSync(entryPath, 'utf8'), "Run 'bun run generate-action-sources' and commit the result").toBe(
      renderEntryModule(relativeDir(actionDir)),
    );
  });

  // The generated entry point imports `run` from here, so an action without it produces a bundle
  // that does not compile.
  it.each(nodeActionDirs)('%s exports run from its action module', (actionDir) => {
    expect(existsSync(path.join(actionDir, ACTION_MODULE_PATH))).toBe(true);
  });

  it.each(nodeActionDirs)('%s agrees with its package.json on the bundle GitHub runs', (actionDir) => {
    // `collectGeneratedModules` passes the manifest path as the source, and the expected build
    // delegation is resolved relative to its directory — so the source must name the manifest, not
    // the directory, or the relative depth comes out one level short.
    const source = `${relativeDir(actionDir)}/action.yaml`;
    const manifest = readFileSync(path.join(actionDir, 'action.yaml'), 'utf8');
    const definition = parseActionDefinition(manifest, source);
    const packageJson = JSON.parse(readFileSync(path.join(actionDir, 'package.json'), 'utf8')) as ActionPackage;

    expect(checkActionStructure(definition, packageJson, source)).toEqual([]);
  });
});
