import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import path from 'node:path';
import { createWorkflow, selectWorkflowDestination } from './lib/workflow-utils.js';

export async function main() {
  console.log(chalk.blue('🚀 Reusable Workflow Generator'));

  const destination = await selectWorkflowDestination();

  const name = await input({
    message: 'Workflow Name (in ' + (destination || 'root') + '):',
    validate: (input) => /^[a-z0-9-]+$/.test(input) || 'Lowercase, numbers, and hyphens only.',
  });

  const fullPath = destination ? path.join(destination, name).replaceAll('\\', '/') : name;

  const description = await input({
    message: 'Description:',
    default: 'A reusable workflow.',
  });

  try {
    await createWorkflow(fullPath, description);
    console.log(chalk.blue('\nDone! 🚀'));
  } catch (error) {
    console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
