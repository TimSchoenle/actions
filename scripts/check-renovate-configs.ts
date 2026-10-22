import fs from 'node:fs';
import path from 'node:path';

import { renovateEntry } from './lib/renovate-tool.js';
import { ROOT_DIR } from './lib/utils.js';

const PRESETS_DIR = path.join('configs', 'renovate');

/** This repository's own config, then every shared preset, as paths relative to the root. */
export function configFiles(): string[] {
  const presets = fs
    .readdirSync(path.join(ROOT_DIR, PRESETS_DIR))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => path.join(PRESETS_DIR, file));

  return ['renovate.json', ...presets];
}

/**
 * Validates every Renovate config in the repository with Renovate's own validator.
 *
 * `--strict` also fails a config that validates only after migration, which is how a deprecated
 * option is caught before Renovate drops it. `--no-global` validates the files as repository
 * configs; given a path, the validator would otherwise treat each as self-hosted global config and
 * accept options no repository may set.
 *
 * @returns the process exit code.
 */
export async function main(): Promise<number> {
  const files = configFiles();
  const proc = Bun.spawn(['node', renovateEntry('config-validator'), '--strict', '--no-global', ...files], {
    cwd: ROOT_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await proc.exited;

  if (exitCode === 0) {
    console.log(`✅ ${files.length} Renovate config(s) are valid.`);
  } else {
    console.error(`❌ Renovate config validation failed (exit code ${exitCode}).`);
  }

  return exitCode;
}

if (import.meta.main) {
  process.exit(await main());
}
