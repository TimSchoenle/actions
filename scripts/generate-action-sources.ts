import path from 'node:path';

import { collectGeneratedModules, findStaleModules } from './lib/action-sources.js';
import { Sys } from './lib/utils.js';

import type { GeneratedModule } from './lib/action-sources.js';

const CHECK_FLAG = '--check';
const STAGE_FLAG = '--stage';

function describe(module: GeneratedModule): string {
  return module.current === undefined ? 'missing' : 'out of date';
}

async function write(module: GeneratedModule): Promise<void> {
  await Sys.mkdir(path.dirname(module.absolutePath), { recursive: true });
  await Sys.write(module.absolutePath, module.expected);
  console.log(`  ${module.current === undefined ? 'created' : 'updated'} ${module.relativePath}`);
}

/**
 * Generates the sources every Node action shares — its typed I/O module and its bundler entry point
 * — from `action.yaml`, and validates that the action's manifest, package manifest and entry point
 * agree on the bundle GitHub runs.
 *
 * `--check` reports drift instead of fixing it, so CI can fail a pull request whose committed
 * sources no longer match the manifests. `--stage` adds the rewritten sources to the index, which is
 * what the pre-commit hook needs to keep a commit self-consistent.
 *
 * @returns the process exit code.
 */
export async function main(argv: string[] = Bun.argv.slice(2)): Promise<number> {
  const check = argv.includes(CHECK_FLAG);
  const stage = argv.includes(STAGE_FLAG);

  const modules = await collectGeneratedModules();
  if (modules.length === 0) {
    console.warn('⚠️ No Node-based actions found — nothing to generate.');
    return 0;
  }

  const stale = findStaleModules(modules);

  if (stale.length === 0) {
    console.log(`✅ ${modules.length} generated action source(s) match their action.yaml.`);
    return 0;
  }

  if (check) {
    console.error(`❌ ${stale.length} generated action source(s) do not match their action.yaml:`);
    for (const module of stale) {
      console.error(`  ${module.relativePath} is ${describe(module)}`);
    }
    console.error("\nRun 'bun run generate-action-sources' and commit the result.");
    return 1;
  }

  console.log(`🔧 Generating ${stale.length} action source(s)...`);
  for (const module of stale) {
    await write(module);
  }

  if (stage) {
    await Sys.exec(`git add ${stale.map((module) => module.relativePath).join(' ')}`);
  }

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
