import path from 'node:path';

import { input } from '@inquirer/prompts';
import chalk from 'chalk';

import { main as generateCodecovComponents } from './generate-codecov-components.js';
import { main as generateDocs } from './generate-docs.js';
import { DOCS_FILE_NAME } from './lib/action-docs/docs-file.js';
import {
  createVerifySource,
  registerActionInReleasePlease,
  selectPackage,
  verifySourcePath,
} from './lib/action-utils.js';
import { ACTIONS_DIR, capitalize, createFromTemplate, ROOT_DIR, Sys } from './lib/utils.js';
import { writeGenerated as generateVerify } from './lib/verify/generate.js';

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

  // Scaffolding over an existing action would replace its docs.yaml with "no permissions, no egress",
  // a false claim that still passes validation.
  if (Sys.exists(actionPath)) {
    throw new Error(`${actionPath} already exists; remove it first or pick another name.`);
  }

  // A target need not be an action: configs/checkstyle has a source and no directory under actions/.
  // Checked before anything is written, so a refused name leaves nothing behind.
  const sourcePath = path.join(ROOT_DIR, verifySourcePath(packageName, subAction));
  if (Sys.exists(sourcePath)) {
    throw new Error(`${sourcePath} already exists; remove it first or pick another name.`);
  }

  // 1. Create Directory Structure
  console.log(chalk.yellow(`\nCreating ${actionPath}...`));
  await Sys.mkdir(actionPath, { recursive: true });

  // 2. Create action.yaml and the docs.yaml the README generator reads beside it
  const replacements = {
    packageName,
    subAction,
    capitalizedPackageName: capitalize(packageName),
    capitalizedSubAction: capitalize(subAction),
    description,
  };
  await createFromTemplate('action/action.yaml', path.join(actionPath, 'action.yaml'), replacements);
  await createFromTemplate('action/docs.yaml', path.join(actionPath, DOCS_FILE_NAME), replacements);

  // 4. Create the verify source and regenerate the Verify workflows that run it, and give the
  // action a Codecov component once it has TypeScript sources.
  await createVerifySource(packageName, subAction);
  generateVerify(ROOT_DIR);
  generateCodecovComponents();

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
