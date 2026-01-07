import { selectWorkflowToRemove, removeWorkflow } from './lib/workflow-utils.js';
import chalk from 'chalk';

export async function main() {
  console.log(chalk.red('🗑️  Reusable Workflow Remover'));

  try {
    const selectedWorkflow = await selectWorkflowToRemove();

    if (selectedWorkflow) {
      await removeWorkflow(selectedWorkflow);
      console.log(chalk.blue('\nDone! 🗑️'));
    }
  } catch (e: any) {
    console.log(chalk.yellow(e.message));
  }
}

if (import.meta.main) {
  await main();
}
