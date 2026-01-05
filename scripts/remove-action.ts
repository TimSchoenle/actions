import path from 'node:path';
import { confirm, search } from '@inquirer/prompts';
import chalk from 'chalk';
import { ACTIONS_DIR, Sys } from './lib/utils.js';
import {
  getSubActions,
  removeActionFromReleasePlease,
  removeVerifyWorkflow,
  selectPackage,
} from './lib/action-utils.js';

export async function main() {
  console.log(chalk.red('🗑️  Shared CI Action Remover'));

  const packageName = await selectPackage(false);

  const packagePath = path.join(ACTIONS_DIR, packageName);
  const subActions = await getSubActions(packageName);

  if (subActions.length === 0) {
    // Just remove the package dir if empty of sub-actions (maybe just config files)
    const shouldRemove = await confirm({
      message: `Package ${packageName} has no sub-actions. Remove entire directory?`,
      default: true,
    });

    if (shouldRemove) {
      await removePackage(packageName);
    }
    return;
  }

  const subAction = await search({
    message: 'Select Sub-Action to remove:',
    source: async (input) => {
      return subActions.filter((sub) => sub.includes(input || '')).map((sub) => ({ name: sub, value: sub }));
    },
  });

  const shouldRemoveAction = await confirm({
    message: `Are you sure you want to remove actions/${packageName}/${subAction}? This cannot be undone.`,
    default: false,
  });

  if (!shouldRemoveAction) {
    console.log('Cancelled.');
    return;
  }

  // 1. Remove Directory
  const actionPath = path.join(packagePath, subAction);
  console.log(chalk.yellow(`Removing ${actionPath}...`));
  await Sys.rm(actionPath, { recursive: true, force: true });

  // 2. Update Release Please Config & Manifest
  await removeActionFromReleasePlease(packageName, subAction);
  await removeVerifyWorkflow(packageName, subAction);

  // 3. Check if Package is now empty (ignoring non-directories or standard files)
  const remaining = await getSubActions(packageName);

  if (remaining.length === 0) {
    console.log(chalk.yellow(`Package ${packageName} is now empty of sub-actions.`));
    const shouldRemovePkg = await confirm({
      message: `Remove package root ${packageName} (including configs/tests)?`,
      default: true,
    });

    if (shouldRemovePkg) {
      await removePackage(packageName);
    } else {
      console.log(chalk.blue('Skipping package root removal.'));
    }
  } else {
    console.log(chalk.blue(`Package ${packageName} still has ${remaining.length} sub-actions.`));
  }

  console.log(chalk.blue('\nDone! 🗑️'));
}

async function removePackage(packageName: string) {
  const packagePath = path.join(ACTIONS_DIR, packageName);
  console.log(chalk.yellow(`Removing package root ${packagePath}...`));

  if (Sys.exists(packagePath)) {
    await Sys.rm(packagePath, { recursive: true, force: true });
  }

  // Check parent directory for emptiness if nested
  let parentDir = path.dirname(packagePath);
  while (parentDir !== ACTIONS_DIR && parentDir.startsWith(ACTIONS_DIR)) {
    const parentContents = Sys.readdir(parentDir);
    if (parentContents.length === 0) {
      console.log(chalk.yellow(`Removing empty parent directory ${parentDir}...`));
      await Sys.rm(parentDir, { recursive: true, force: true });
      parentDir = path.dirname(parentDir);
    } else {
      break;
    }
  }

  // Verify jobs are per-action and removed above.
}

if (import.meta.main) {
  await main();
}
