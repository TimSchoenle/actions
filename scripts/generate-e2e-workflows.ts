import fs from 'node:fs';
import path from 'node:path';

import chalk from 'chalk';

import { extraJobsPath, findE2eActions, renderE2eWorkflow, workflowFileName } from './lib/e2e-workflow.js';
import { ROOT_DIR } from './lib/utils.js';

const WORKFLOWS_DIR = path.join(ROOT_DIR, '.github', 'workflows');

/** Reads an action's optional extra-jobs fragment, or an empty string when it has none. */
function readExtraJobs(action: Parameters<typeof extraJobsPath>[0]): string {
  const fragmentPath = path.join(ROOT_DIR, extraJobsPath(action));

  return fs.existsSync(fragmentPath) ? stripComments(fs.readFileSync(fragmentPath, 'utf8')) : '';
}

/**
 * Drops the fragment's own explanatory header.
 *
 * The header explains to a reader of the action why those jobs cannot be end-to-end cases; repeating
 * it in the generated workflow would put the rationale where nobody editing the action would see it.
 */
function stripComments(fragment: string): string {
  const lines = fragment.split(/\r?\n/);
  const firstJob = lines.findIndex((line) => !line.startsWith('#') && line.trim() !== '');

  return firstJob === -1 ? '' : lines.slice(firstJob).join('\n');
}

/** One workflow whose content on disk differs from what the generator produces. */
export interface WorkflowDrift {
  file: string;
  reason: 'missing' | 'stale';
}

/**
 * Compares every action's generated workflow against what is on disk.
 *
 * Reported rather than thrown so `--check` can list every drifted file at once; a generator that
 * stopped at the first difference would take one CI round-trip per stale workflow to converge.
 */
export async function findDrift(): Promise<WorkflowDrift[]> {
  const drift: WorkflowDrift[] = [];

  for (const action of await findE2eActions()) {
    const file = workflowFileName(action);
    const filePath = path.join(WORKFLOWS_DIR, file);

    if (!fs.existsSync(filePath)) {
      drift.push({ file, reason: 'missing' });
    } else if (fs.readFileSync(filePath, 'utf8') !== renderE2eWorkflow(action, readExtraJobs(action))) {
      drift.push({ file, reason: 'stale' });
    }
  }

  return drift;
}

/** Writes every action's workflow, returning the files that changed. */
export async function writeWorkflows(): Promise<string[]> {
  const written: string[] = [];

  for (const action of await findE2eActions()) {
    const file = workflowFileName(action);
    const filePath = path.join(WORKFLOWS_DIR, file);
    const next = renderE2eWorkflow(action, readExtraJobs(action));

    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== next) {
      fs.writeFileSync(filePath, next);
      written.push(file);
    }
  }

  return written;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--check')) {
    const drift = await findDrift();

    if (drift.length > 0) {
      console.error(chalk.red(`${drift.length} end-to-end workflow(s) are out of date:`));
      for (const { file, reason } of drift) {
        console.error(chalk.red(`  ${reason.padEnd(7)} ${file}`));
      }
      console.error(chalk.yellow("Run 'bun run generate-e2e-workflows' and commit the result."));

      return 1;
    }

    console.log(chalk.green('✅ Every end-to-end workflow matches its generator.'));

    return 0;
  }

  const written = await writeWorkflows();

  if (written.length === 0) {
    console.log(chalk.blue('End-to-end workflows are already up to date.'));
  } else {
    console.log(chalk.green(`Wrote ${written.length} end-to-end workflow(s):`));
    for (const file of written) {
      console.log(chalk.green(`  ${file}`));
    }
  }

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
