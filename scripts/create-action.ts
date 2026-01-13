import path from 'node:path';

import { input } from '@inquirer/prompts';
import chalk from 'chalk';

import { main as generateDocs } from './generate-docs.js';
import { createVerifyWorkflow, registerActionInReleasePlease, selectPackage } from './lib/action-utils.js';
import { ACTIONS_DIR, capitalize, createFromTemplate, Sys } from './lib/utils.js';

export async function main() {
  console.log(chalk.blue('🚀 Shared CI Action Generator'));

  // 1. Determine Package Name (New or Existing)
  const packageName = await selectPackage(true);

  const subAction = await input({
    message: 'Sub-Action Name (e.g., setup, validate):',
    default: 'setup',
    validate: (input) => /^[a-z0-9-]+$/.test(input) || 'Lowercase, numbers, and hyphens only.',
  });

  const description = await input({
    message: 'Description:',
    default: 'A reusable action.',
  });

  const packagePath = path.join(ACTIONS_DIR, packageName);
  const actionPath = path.join(packagePath, subAction);

  // 1. Create Directory Structure
  console.log(chalk.yellow(`\nCreating ${actionPath}...`));
  await Sys.mkdir(actionPath, { recursive: true });

  // 2. Create action.yaml
  await createFromTemplate('action/action.yaml', path.join(actionPath, 'action.yaml'), {
    packageName,
    subAction,
    capitalizedPackageName: capitalize(packageName),
    capitalizedSubAction: capitalize(subAction),
    description,
  });

  // 4. Create Verification Workflow
  await createVerifyWorkflow(packageName, subAction);

  // 5. Update Release Please Config
  await registerActionInReleasePlease(packageName, subAction);

  // 6. Regenerate README
  console.log(chalk.blue('\nUpdating README.md...'));
  await generateDocs();

  console.log(chalk.blue('\nDone! 🚀'));
}

if (import.meta.main) {
  await main();
}
