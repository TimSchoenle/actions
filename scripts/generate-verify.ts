import chalk from 'chalk';

import { ROOT_DIR } from './lib/utils.js';
import { findDrift, writeGenerated } from './lib/verify/generate.js';

/**
 * Generates `.github/workflows/verify.yaml`, its shard workflows and `.github/verify/plan.json` from
 * the sources in `.github/verify/`. With `--check`, reports drift instead of writing.
 */
export function main(argv: readonly string[] = process.argv.slice(2), root = ROOT_DIR): number {
  if (argv.includes('--check')) {
    const drift = findDrift(root);
    if (drift.length > 0) {
      console.error(chalk.red(`${drift.length} generated Verify file(s) are out of date:`));
      for (const { file, reason } of drift) {
        console.error(chalk.red(`  ${reason.padEnd(8)} ${file}`));
      }
      console.error(chalk.yellow("Run 'bun run generate-verify' and commit the result."));

      return 1;
    }
    console.log(chalk.green('Every generated Verify file matches its sources.'));

    return 0;
  }

  const changed = writeGenerated(root);
  if (changed.length === 0) {
    console.log(chalk.blue('The generated Verify files are already up to date.'));
  } else {
    console.log(chalk.green(`Updated ${changed.length} generated Verify file(s):`));
    for (const file of changed) {
      console.log(chalk.green(`  ${file}`));
    }
  }

  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
