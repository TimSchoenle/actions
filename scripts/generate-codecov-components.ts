import fs from 'node:fs';
import path from 'node:path';

import chalk from 'chalk';

import { applyGeneratedComponents, collectMeasuredActions } from './lib/codecov-components.js';
import { ACTIONS_DIR, ROOT_DIR } from './lib/utils.js';

const CODECOV_CONFIG_PATH = path.join(ROOT_DIR, '.github', 'codecov.yml');

/** Directories that never hold measured sources and can be large: skipped while walking. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'fixture', '.gradle', 'build', 'target']);

function walk(directory: string, files: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        walk(entryPath, files);
      }
    } else if (entry.isFile()) {
      files.push(path.relative(ROOT_DIR, entryPath));
    }
  }
}

/** Every file under `actions/`, as a path relative to the repository root. */
export function listActionFiles(): string[] {
  const files: string[] = [];
  walk(ACTIONS_DIR, files);
  return files;
}

// Rebuilds the per-action component list in .github/codecov.yml from the actions on disk, so a new
// action shows up in the Codecov comment without a hand edit. The codecov-components drift test
// fails CI when the committed list is stale.
export function main(): void {
  const actions = collectMeasuredActions(listActionFiles());
  const current = fs.readFileSync(CODECOV_CONFIG_PATH, 'utf8');
  const next = applyGeneratedComponents(current, actions);

  if (next === current) {
    console.log(chalk.blue('Codecov components are already up to date.'));
    return;
  }

  fs.writeFileSync(CODECOV_CONFIG_PATH, next);
  console.log(chalk.green(`Synced Codecov components: ${actions.length} action(s).`));
}

if (import.meta.main) {
  main();
}
