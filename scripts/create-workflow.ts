import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import path from 'node:path';
import { Sys, capitalize, createFromTemplate, START_VERSION, ROOT_DIR } from './lib/utils.js';
import { selectPackage, registerResourceInReleasePlease, createVerifyWorkflow } from './lib/resource-utils.js';
import { getRepoInfo } from './lib/readme/git-utils.js';
import { main as generateDocs } from './generate-docs.js';

const WORKFLOWS_DIR = path.join(ROOT_DIR, 'workflows');

export async function main() {
  console.log(chalk.blue('🚀 Reusable Workflow Generator'));

  // 1. Determine Package Name (New or Existing)
  const packageName = await selectPackage('workflow', true);

  const subAction = await input({
    message: 'Workflow Name (e.g., build, deploy):',
    default: 'build',
    validate: (input) => /^[a-z0-9-]+$/.test(input) || 'Lowercase, numbers, and hyphens only.',
  });

  const description = await input({
    message: 'Description:',
    default: 'A reusable workflow.',
  });

  const packagePath = path.join(WORKFLOWS_DIR, packageName);
  const actionPath = path.join(packagePath, subAction);

  // 1. Create Directory Structure
  console.log(chalk.yellow(`\nCreating ${actionPath}...`));
  await Sys.mkdir(actionPath, { recursive: true });

  const repoId = await getRepoInfo();

  // 2. Create workflow.yaml
  await createFromTemplate('workflow/workflow.yaml', path.join(actionPath, 'workflow.yaml'), {
    packageName,
    subAction,
    capitalizedPackageName: capitalize(packageName),
    capitalizedSubAction: capitalize(subAction),
    description,
  });

  // 3. Create Package-level files if missing (CHANGELOG)
  const changelogPath = path.join(actionPath, 'CHANGELOG.md');
  if (!Sys.exists(changelogPath)) {
    console.log(chalk.green('Creating CHANGELOG.md...'));
    await createFromTemplate('common/CHANGELOG.md', changelogPath, {
      date: new Date().toISOString().split('T')[0],
      version: START_VERSION,
      packageName,
      subAction,
    });
  }

  // 4. Create README.md
  const readmePath = path.join(actionPath, 'README.md');
  if (!Sys.exists(readmePath)) {
    console.log(chalk.green('Creating README.md...'));
    await createFromTemplate('workflow/README.md', readmePath, {
      packageName,
      subAction,
      capitalizedPackageName: capitalize(packageName),
      capitalizedSubAction: capitalize(subAction),
      description,
      repo: repoId,
      tag: `workflows-${packageName}-${subAction}-v${START_VERSION}`,
      subName: subAction, // For template consistency
    });
  }

  // 5. Create Verification Workflow
  await createVerifyWorkflow('workflow', packageName, subAction);

  // 6. Update Release Please Config
  await registerResourceInReleasePlease('workflow', packageName, subAction);

  // 7. Regenerate README
  console.log(chalk.blue('\nUpdating README.md...'));
  await generateDocs();

  console.log(chalk.blue('\nDone! 🚀'));
}

if (import.meta.main) {
  await main();
}
